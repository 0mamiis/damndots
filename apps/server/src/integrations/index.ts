import {stripAnnotations} from '../voice-text.js';
import { createHmac, randomUUID } from 'node:crypto';
import type { Connector, ConnectorKind, RecordStore, ToolDefinition } from '@dots/contracts';
import { SecretVault, endpoint, IntegrationError, mergeConfig, object, redact, required, verifyHmac } from './security.js';
import { emailConfig, github, json, readMail, scoped, slack, smtpTransport, teamsToken, toolsets, validateTeams, withImap, withMcp, type ProviderContext } from './providers.js';
export { IntegrationError } from './security.js';

export interface IntegrationOptions {
  encryptionKey:string|Buffer;
  inbound:(dotId:string,text:string,channel:string,requestId:string,context?:InboundContext)=>Promise<unknown>;
  authorizeSend?:(connector:Connector,tool:string,args:Record<string,unknown>)=>Promise<boolean>;
  emit?:(type:string,data:Record<string,unknown>)=>void;
  fetch?:typeof fetch;
  now?:()=>number;
}
export type ReplyTarget={kind:'slack';channel:string;threadTs?:string}|{kind:'teams';conversationId:string;serviceUrl:string}|{kind:'email';to:string;subject:string;inReplyTo:string}|{kind:'webhook';requestId:string};
export interface InboundContext {connectorId:string;replyTarget?:ReplyTarget;}
export interface ReplyOutbox {id:string;connectorId:string;taskId:string;status:'pending'|'approval_required'|'sending'|'sent'|'failed'|'delivery_unknown';attempts:number;lastError:string|null;createdAt:string;updatedAt:string;}
interface StoredReply extends ReplyOutbox {encryptedRequest:string;}
interface InboundBinding {connectorId:string;replyTarget:ReplyTarget;requestId:string;channel:string;dotId:string;}
export interface ConnectorInput {kind:ConnectorKind;name:string;config:Record<string,unknown>;scopes?:string[];enabled?:boolean;}
export interface ToolCallPolicy {readOnly?:boolean;}
type StoredConnector=Omit<Connector,'config'> & {encryptedConfig:string};
export interface VoiceSettings {enabled:boolean;apiUrl:string;apiKey?:string;transcriptionModel:string;speechModel:string;realtimeModel?:string;voice:string;format:'mp3'|'wav'|'opus'|'aac'|'flac'|'pcm';language?:string;mode?:'auto'|'realtime'|'pipeline';transcriptionMode?:'auto'|'audio'|'chat';followCodexVoice?:boolean;}
const defaults:VoiceSettings={enabled:false,apiUrl:'https://api.openai.com/v1',transcriptionModel:'gpt-4o-mini-transcribe',speechModel:'gpt-4o-mini-tts',realtimeModel:'gpt-realtime-1.5',voice:'coral',format:'mp3'};
const kinds:ConnectorKind[]=['slack','teams','email','mcp','webhook','github'];

/** Reads a chat completion from plain JSON or from the SSE form some gateways return even when streaming was not requested. */
export function chatCompletionText(raw:string):string {
  const content=(value:any):string=>Array.isArray(value)?value.map((p:any)=>p?.text??'').join(''):typeof value==='string'?value:'';
  const body=raw.trim();
  try{return content(JSON.parse(body)?.choices?.[0]?.message?.content).trim();}catch{ /* not a single JSON document */ }
  let streamed='',whole='';
  for(const line of body.split(/\r?\n/)){
    const data=line.replace(/^data:\s*/,'').replace(/data:\s*\[DONE\]\s*$/,'').trim();
    if(!data||data==='[DONE]')continue;
    try{const choice=JSON.parse(data)?.choices?.[0];streamed+=content(choice?.delta?.content);whole+=content(choice?.message?.content);}catch{ /* ignore non-JSON lines */ }
  }
  return (whole||streamed).trim();
}
/** Models mark non-speech with [silence], sometimes after real words; the marker is never part of what was said. */
export function cleanTranscript(text:string):string {
  text=stripAnnotations(text);
  return text.replace(/\[\s*silence\s*\]/gi,' ').replace(/^\s*silence\.?\s*$/i,'').replace(/\s+/g,' ').trim();
}
export class IntegrationService {
  private vault:SecretVault;
  private ctx:ProviderContext;
  private inflight=new Map<string,Promise<unknown>>();
  private mailAuth=new Map<string,Promise<Record<string,any>>>();
  private replies=new Map<string,Promise<ReplyOutbox>>();
  private polling=new Map<string,Promise<unknown>>();
  private emailJobs=new Map<string,Promise<{received:number}>>();
  private timers:ReturnType<typeof setInterval>[]=[];
  constructor(private store:RecordStore,private options:IntegrationOptions) {
    this.vault=new SecretVault(options.encryptionKey);
    this.ctx={fetch:options.fetch??fetch,now:options.now??Date.now};
  }
  private stamp():string{return new Date(this.ctx.now()).toISOString();}
  private stored(id:string):StoredConnector {
    const value=this.store.get<StoredConnector>('connectors',id);
    if(!value)throw new IntegrationError('Connector not found',404);return value;
  }
  private privateConnector(id:string):Connector {
    const {encryptedConfig,...value}=this.stored(id);return {...value,config:this.vault.open(encryptedConfig)};
  }
  private active(id:string):Connector {const connector=this.privateConnector(id);if(!connector.enabled)throw new IntegrationError('Connector is disabled',409);return connector;}
  get(id:string):Connector {const value=this.privateConnector(id);return {...value,config:redact(value.config)};}
  list():Connector[] {return this.store.list<StoredConnector>('connectors').map(c=>this.get(c.id));}
  create(input:ConnectorInput):Connector {
    if(!kinds.includes(input.kind))throw new IntegrationError('Invalid connector kind');
    const config=object(input.config);this.validateConfigUrls(config);
    const now=this.stamp();
    const value:StoredConnector={id:randomUUID(),kind:input.kind,name:required(input.name,'name'),enabled:input.enabled??true,scopes:this.validateScopes(input.scopes??[]),state:this.missing(input.kind,config).length?'needs_configuration':'configured',encryptedConfig:this.vault.seal(config),lastError:null,createdAt:now,updatedAt:now};
    this.store.put('connectors',value);this.changed(value.id);return this.get(value.id);
  }
  update(id:string,input:Partial<Omit<ConnectorInput,'kind'>>):Connector {
    const old=this.stored(id),config=input.config?mergeConfig(this.vault.open(old.encryptedConfig),object(input.config)):this.vault.open(old.encryptedConfig);
    this.validateConfigUrls(config);
    const value={...old,name:input.name===undefined?old.name:required(input.name,'name'),enabled:input.enabled??old.enabled,scopes:input.scopes?this.validateScopes(input.scopes):old.scopes,encryptedConfig:this.vault.seal(config),state:this.missing(old.kind,config).length?'needs_configuration' as const:'configured' as const,lastError:null,updatedAt:this.stamp()};
    this.store.put('connectors',value);this.changed(id);return this.get(id);
  }
  delete(id:string):boolean {this.stored(id);const deleted=this.store.delete('connectors',id);this.changed(id);return deleted;}
  private changed(id:string):void {this.options.emit?.('connector.updated',{connectorId:id});}
  private validateScopes(value:unknown):string[] {if(!Array.isArray(value)||value.some(s=>typeof s!=='string'))throw new IntegrationError('scopes must be strings');return [...new Set(value)];}
  private validateConfigUrls(config:Record<string,any>):void {
    for(const [key,value] of Object.entries(config)) {
      if(value && typeof value==='object')this.validateConfigUrls(value);
      if(value && /url$/i.test(key))endpoint(value);
    }
  }
  private missing(kind:ConnectorKind,c:Record<string,any>):string[] {
    switch(kind) {
      case 'slack':return ['botToken','signingSecret'].filter(k=>!c[k]);
      case 'teams':return ['appId','appSecret'].filter(k=>!c[k]);
      case 'github':return ['token','owner','repo'].filter(k=>!c[k]);
      case 'webhook':return !c.signingSecret?['signingSecret']:[];
      case 'mcp':return !c.url?['url']:[];
      case 'email':return ['smtp','imap'].filter(k=>!c[k]?.host||!c[k]?.user||(!c[k]?.password&&!c[k]?.accessToken&&!(c[k]?.oauth?.refreshToken&&c[k]?.oauth?.clientId&&c[k]?.oauth?.tokenUrl)));
    }
  }
  private setState(id:string,state:Connector['state'],error:string|null):Connector {
    const value=this.stored(id);this.store.put('connectors',{...value,state,lastError:error,updatedAt:this.stamp()});this.changed(id);return this.get(id);
  }
  async test(id:string):Promise<Connector> {
    const connector=this.active(id),c=object(connector.config),missing=this.missing(connector.kind,c);
    if(missing.length)return this.setState(id,'needs_configuration',`Missing: ${missing.join(', ')}`);
    try {
      switch(connector.kind) {
        case 'slack':await slack(this.ctx,c,'auth.test');break;
        case 'teams':await teamsToken(this.ctx,c);break;
        case 'github':await github(this.ctx,c,`/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`);break;
        case 'mcp':await withMcp(c,client=>client.listTools());break;
        case 'email':{
          const transport=smtpTransport(await this.mailConfig(id,'smtp',c.smtp));try{await transport.verify();}finally{transport.close();}
          await withImap(await this.mailConfig(id,'imap',c.imap),client=>client.noop());break;
        }
        case 'webhook':{
          if(!c.healthUrl)return this.setState(id,'configured','Provider connection is unverified; configure healthUrl for a read-only probe');
          const response=await this.ctx.fetch(endpoint(c.healthUrl),{method:'GET',signal:AbortSignal.timeout(15_000),redirect:'error'});
          if(!response.ok)throw new IntegrationError(`Webhook health HTTP ${response.status}`,502);break;
        }
      }
      return this.setState(id,'connected',null);
    }catch(error){return this.setState(id,'error',this.safeError(error));}
  }
  private safeError(error:unknown):string {
    // Avoid persisting provider exception bodies, URLs, or credentials.
    if(error instanceof IntegrationError)return error.message;
    return 'Provider connection failed; check credentials, permissions, endpoint, and TLS';
  }
  private async mailConfig(id:string,transport:'smtp'|'imap',config:Record<string,any>):Promise<Record<string,any>> {
    const key=`${id}:${transport}`,pending=this.mailAuth.get(key);if(pending)return pending;
    const job=(async()=>{
      const fresh=object(this.privateConnector(id).config[transport]);
      const result=await emailConfig(this.ctx,fresh);
      if(result.oauth?.refreshToken && result.oauth.refreshToken!==fresh.oauth?.refreshToken) {
        this.store.transaction(()=>{
          const stored=this.stored(id),current=this.vault.open(stored.encryptedConfig);
          current[transport]={...current[transport],oauth:{...current[transport]?.oauth,refreshToken:result.oauth.refreshToken}};
          this.store.put('connectors',{...stored,encryptedConfig:this.vault.seal(current),updatedAt:this.stamp()});
        });
      }
      return result;
    })();
    this.mailAuth.set(key,job);try{return await job;}finally{this.mailAuth.delete(key);}
  }
  async tools(id:string):Promise<ToolDefinition[]> {
    const connector=this.active(id);
    if(connector.kind==='mcp') {
      scoped(connector,'tools:read');
      return withMcp(connector.config,async client=>{
        const tools:ToolDefinition[]=[];let cursor:string|undefined;
        do {const page=await client.listTools({cursor});tools.push(...page.tools.map(t=>({name:t.name,description:t.description??'',inputSchema:t.inputSchema,connectorId:id})));cursor=page.nextCursor;}while(cursor);
        return tools;
      });
    }
    return (toolsets[connector.kind]??[]).filter(tool=>connector.scopes.includes(this.toolScope(connector.kind,tool.name))).map(t=>({...t,connectorId:id}));
  }
  private toolScope(kind:ConnectorKind,name:string):string {
    if(kind==='slack')return name==='send_message'?'chat:write':'history:read';
    if(kind==='teams')return 'messages:send';
    if(kind==='email')return name==='send_message'?'mail:send':'mail:read';
    if(kind==='github')return name==='create_issue'?'issues:write':'repo:read';
    if(kind==='webhook')return 'webhook:send';return 'tools:call';
  }
  async isReadOnlyTool(id:string,name:string):Promise<boolean> {
    const connector=this.active(id),c=object(connector.config);
    scoped(connector,this.toolScope(connector.kind,name));
    if(connector.kind!=='mcp')return (toolsets[connector.kind]??[]).some(t=>t.name===name)&&['read_messages','get_repository','list_issues'].includes(name);
    scoped(connector,'tools:read');
    return withMcp(c,async client=>{
      let cursor:string|undefined;
      do {const page=await client.listTools({cursor}),tool=page.tools.find(t=>t.name===name);if(tool)return this.mcpReadOnly(c,name,tool.annotations?.readOnlyHint);cursor=page.nextCursor;}while(cursor);
      throw new IntegrationError('Tool not found',404);
    });
  }
  private mcpReadOnly(config:Record<string,any>,name:string,hint:unknown):boolean {
    // MCP annotations are hints from a third party, not an authorization grant.
    return hint===true && Array.isArray(config.readOnlyTools) && config.readOnlyTools.includes(name);
  }
  async call(id:string,name:string,args:Record<string,unknown>,policy:ToolCallPolicy={}):Promise<unknown> {
    return this.callInternal(id,name,args,undefined,policy);
  }
  private async callInternal(id:string,name:string,args:Record<string,unknown>,reply?:{target:ReplyTarget;auto:boolean},policy:ToolCallPolicy={}):Promise<unknown> {
    const connector=this.active(id),c=object(connector.config),a=object(args);
    const missing=this.missing(connector.kind,c);
    if(missing.length)throw new IntegrationError(`Connector needs configuration: ${missing.join(', ')}`,409);
    if(connector.kind==='webhook' && name==='send')endpoint(c.url);
    scoped(connector,this.toolScope(connector.kind,name));
    let readOnly=false;
    if(connector.kind==='mcp') {
      scoped(connector,'tools:read');
      return withMcp(c,async client=>{
        let cursor:string|undefined;let tool;
        do {const page=await client.listTools({cursor});tool=page.tools.find(t=>t.name===name);cursor=page.nextCursor;}while(!tool&&cursor);
        if(!tool)throw new IntegrationError('Tool not found',404);
        const readOnly=this.mcpReadOnly(c,name,tool.annotations?.readOnlyHint);
        if(policy.readOnly && !readOnly)throw new IntegrationError('Read-only tool policy denies this operation',403);
        if(!readOnly)await this.approve(connector,name,a);
        return client.callTool({name,arguments:a});
      });
    }
    if(!(toolsets[connector.kind]??[]).some(t=>t.name===name))throw new IntegrationError('Tool not found',404);
    readOnly=['read_messages','get_repository','list_issues'].includes(name);
    if(policy.readOnly && !readOnly)throw new IntegrationError('Read-only tool policy denies this operation',403);
    if(!readOnly && !reply?.auto)await this.approve(connector,name,a);
    switch(connector.kind) {
      case 'slack':return name==='send_message'?slack(this.ctx,c,'chat.postMessage',{channel:required(a.channel,'channel'),text:required(a.text,'text'),...(a.thread_ts?{thread_ts:required(a.thread_ts,'thread_ts')}:{})}):slack(this.ctx,c,'conversations.history',{channel:required(a.channel,'channel'),limit:this.limit(a.limit)});
      case 'email':{
        if(readOnly)return readMail(await this.mailConfig(id,'imap',c.imap),this.uid(a.afterUid),this.limit(a.limit));
        const transport=smtpTransport(await this.mailConfig(id,'smtp',c.smtp));
        try{const result=await transport.sendMail({from:required(c.from??c.smtp.user,'from'),to:required(a.to,'to'),subject:required(a.subject,'subject'),text:required(a.text,'text'),...(reply?.target.kind==='email'?{inReplyTo:reply.target.inReplyTo,references:[reply.target.inReplyTo]}:{})});return {messageId:result.messageId,accepted:result.accepted,rejected:result.rejected};}finally{transport.close();}
      }
      case 'teams':{
        const service=endpoint(required(a.serviceUrl??c.serviceUrl,'serviceUrl'));
        const allowed=c.allowedServiceUrls??(c.serviceUrl?[c.serviceUrl]:[]);
        const authenticatedReply=reply?.target.kind==='teams' && endpoint(reply.target.serviceUrl)===service && reply.target.conversationId===a.conversationId;
        if(!authenticatedReply && (!Array.isArray(allowed)||!allowed.some((u:any)=>endpoint(u)===service)))throw new IntegrationError('Teams serviceUrl is not configured',403);
        const token=await teamsToken(this.ctx,c);
        return json(this.ctx,`${service.replace(/\/$/,'')}/v3/conversations/${encodeURIComponent(required(a.conversationId,'conversationId'))}/activities`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({type:'message',text:required(a.text,'text'),from:{id:c.appId}})});
      }
      case 'github':{
        const path=`/repos/${encodeURIComponent(required(c.owner,'owner'))}/${encodeURIComponent(required(c.repo,'repo'))}`;
        if(name==='get_repository')return github(this.ctx,c,path);
        if(name==='list_issues')return github(this.ctx,c,`${path}/issues?state=open&per_page=100`);
        return github(this.ctx,c,`${path}/issues`,'POST',{title:required(a.title,'title'),body:typeof a.body==='string'?a.body:''});
      }
      case 'webhook':{
        const body=Buffer.from(JSON.stringify(object(a.payload))),timestamp=String(Math.floor(this.ctx.now()/1000));
        const signature='sha256='+createHmac('sha256',required(c.signingSecret,'signingSecret')).update(Buffer.concat([Buffer.from(`${timestamp}.`),body])).digest('hex');
        return json(this.ctx,endpoint(c.url),{method:'POST',headers:{'content-type':'application/json','x-dots-timestamp':timestamp,'x-dots-signature':signature},body});
      }
    }
  }
  private async approve(connector:Connector,name:string,args:Record<string,unknown>):Promise<void> {
    if(!this.options.authorizeSend || !await this.options.authorizeSend({...connector,config:redact(connector.config)},name,args))throw new IntegrationError('Outbound action requires approval',403);
  }
  private limit(value:unknown):number {const n=value===undefined?20:Number(value);if(!Number.isInteger(n)||n<1||n>100)throw new IntegrationError('limit must be 1..100');return n;}
  private uid(value:unknown):number {const n=value===undefined?0:Number(value);if(!Number.isSafeInteger(n)||n<0)throw new IntegrationError('Invalid IMAP UID');return n;}
  private async deliver(connector:Connector,text:string,channel:string,requestId:string,replyTarget?:ReplyTarget):Promise<unknown> {
    const dotId=required(connector.config.dotId,'dotId'),id=`${connector.id}:${requestId}`;
    if(this.store.get('integration_receipts',id))return {duplicate:true};
    if(this.inflight.has(id))return this.inflight.get(id);
    const job=(async()=>{
      const result=await this.options.inbound(dotId,text,channel,id,{connectorId:connector.id,...replyTarget?{replyTarget}:{}});
      const taskId=(result as any)?.task?.id;
      this.store.transaction(()=>{
        if(replyTarget && typeof taskId==='string')this.store.put('integration_bindings',{id:taskId,encryptedBinding:this.vault.seal({connectorId:connector.id,replyTarget,requestId:id,channel,dotId})});
        this.store.put('integration_receipts',{id,receivedAt:this.stamp()});
      });return result;
    })();
    this.inflight.set(id,job);try{return await job;}finally{this.inflight.delete(id);}
  }
  async webhook(id:string,headers:Record<string,string|string[]|undefined>,raw:Buffer):Promise<{statusCode:number;body:unknown}> {
    const connector=this.active(id),c=object(connector.config);
    if(raw.length>1_048_576)throw new IntegrationError('Webhook body too large',413);
    const header=(key:string)=>{const value=headers[key]??headers[key.toLowerCase()];return Array.isArray(value)?value[0]:value;};
    if(connector.kind==='slack')verifyHmac(required(c.signingSecret,'signingSecret'),raw,header('x-slack-request-timestamp'),header('x-slack-signature'),this.ctx.now(),true);
    if(connector.kind==='webhook')verifyHmac(required(c.signingSecret,'signingSecret'),raw,header('x-dots-timestamp'),header('x-dots-signature'),this.ctx.now());
    let event:Record<string,any>;try{event=object(JSON.parse(raw.toString('utf8')));}catch{throw new IntegrationError('Invalid webhook JSON');}
    if(connector.kind==='slack') {
      if(event.type==='url_verification')return {statusCode:200,body:{challenge:required(event.challenge,'challenge')}};
      if(c.teamId && event.team_id!==c.teamId)throw new IntegrationError('Unexpected Slack workspace',403);
      const message=event.event;
      if(message && !message.bot_id && !message.subtype && (message.type==='app_mention'||(message.type==='message'&&message.channel_type==='im'))) {
        scoped(connector,'events:read');
        const channel=required(message.channel,'channel');
        await this.deliver(connector,required(message.text,'text'),`slack:${channel}`,required(event.event_id,'event_id'),{kind:'slack',channel,...typeof (message.thread_ts??message.ts)==='string'?{threadTs:message.thread_ts??message.ts}:{}});
      }
    }else if(connector.kind==='teams') {
      await validateTeams(this.ctx,c,header('authorization'),event);
      if(event.type==='message') {
        scoped(connector,'messages:read');
        if(c.tenantId && event.channelData?.tenant?.id!==c.tenantId)throw new IntegrationError('Unexpected Teams tenant',403);
        const conversationId=required(event.conversation?.id,'conversation.id');
        await this.deliver(connector,required(event.text,'text'),`teams:${conversationId}`,required(event.id,'activity.id'),{kind:'teams',conversationId,serviceUrl:endpoint(event.serviceUrl)});
      }
    }else if(connector.kind==='webhook') {
      scoped(connector,'webhook:receive');
      const requestId=required(event.requestId,'requestId');
      await this.deliver(connector,required(event.text,'text'),`webhook:${id}`,requestId,c.url?{kind:'webhook',requestId}:undefined);
    }else throw new IntegrationError('Connector does not receive webhooks');
    return {statusCode:200,body:{ok:true}};
  }
  async pollEmail(id:string):Promise<{received:number}> {
    const pending=this.emailJobs.get(id);if(pending)return pending;
    const job=this.pollEmailOnce(id);this.emailJobs.set(id,job);try{return await job;}finally{this.emailJobs.delete(id);}
  }
  private async pollEmailOnce(id:string):Promise<{received:number}> {
    const connector=this.active(id);if(connector.kind!=='email')throw new IntegrationError('Not an email connector');scoped(connector,'mail:read');
    const c=object(connector.config),state=this.store.get<{id:string;uid:number;validity:string}>('email_cursors',id);
    // IMAP UIDVALIDITY changes invalidate the old cursor. readMail returns mailbox validity per message.
    const messages=await readMail(await this.mailConfig(id,'imap',c.imap),state?.uid??0,100,state?.validity);let received=0;
    for(const mail of messages) {
      if(state?.validity===mail.uidValidity&&mail.uid<=state.uid)continue;
      if(Array.isArray(c.allowedSenders) && !c.allowedSenders.some((sender:string)=>mail.fromAddresses.includes(sender.toLowerCase()))) {
        this.store.put('email_cursors',{id,uid:mail.uid,validity:mail.uidValidity});continue;
      }
      const to=mail.fromAddresses.find(address=>Array.isArray(c.allowedSenders)&&c.allowedSenders.some((sender:string)=>sender.toLowerCase()===address));
      await this.deliver(connector,`From: ${mail.from}\nSubject: ${mail.subject}\n\n${mail.text}`,`email:${c.imap.user}`,`${mail.uidValidity}:${mail.uid}`,to?{kind:'email',to,subject:/^re:/i.test(mail.subject)?mail.subject:`Re: ${mail.subject}`,inReplyTo:mail.messageId}:undefined);
      this.store.put('email_cursors',{id,uid:mail.uid,validity:mail.uidValidity});received++;
    }
    return {received};
  }
  private binding(taskId:string):InboundBinding|undefined {
    const row=this.store.get<{id:string;encryptedBinding:string}>('integration_bindings',taskId);
    return row?this.vault.open(row.encryptedBinding) as InboundBinding:undefined;
  }
  private storedReply(id:string):StoredReply {
    const row=this.store.get<StoredReply>('integration_outbox',id);if(!row)throw new IntegrationError('Reply outbox item not found',404);return row;
  }
  private publicReply(row:StoredReply):ReplyOutbox {const {encryptedRequest,...value}=row;return value;}
  listOutbox():ReplyOutbox[] {return this.store.list<StoredReply>('integration_outbox').map(row=>this.publicReply(row));}
  getReplyRequest(id:string):{connectorId:string;tool:string;arguments:Record<string,unknown>} {
    const row=this.storedReply(id),request=this.vault.open(row.encryptedRequest);
    return {connectorId:row.connectorId,tool:request.tool,arguments:request.arguments};
  }
  private receiveScope(kind:ConnectorKind):string {
    if(kind==='slack')return 'events:read';if(kind==='teams')return 'messages:read';if(kind==='email')return 'mail:read';return 'webhook:receive';
  }
  private replyArguments(target:ReplyTarget,text:string):{tool:string;arguments:Record<string,unknown>} {
    if(target.kind==='slack')return {tool:'send_message',arguments:{channel:target.channel,text,...target.threadTs?{thread_ts:target.threadTs}:{}}};
    if(target.kind==='teams')return {tool:'send_message',arguments:{conversationId:target.conversationId,serviceUrl:target.serviceUrl,text}};
    if(target.kind==='email')return {tool:'send_message',arguments:{to:target.to,subject:target.subject,text}};
    return {tool:'send',arguments:{payload:{text,inReplyTo:target.requestId,requestId:`reply:${target.requestId}`}}};
  }
  private canAutoReply(connector:Connector,tool:string):boolean {
    return connector.config.autoReply===true && connector.scopes.includes(this.receiveScope(connector.kind)) && connector.scopes.includes(this.toolScope(connector.kind,tool));
  }
  async enqueueReply(taskId:string,text:string):Promise<ReplyOutbox|null> {
    let binding=this.binding(taskId);
    // A very fast completed task may race the await of inbound submission.
    if(!binding && this.inflight.size){await Promise.allSettled([...this.inflight.values()]);binding=this.binding(taskId);}
    if(!binding || !text.trim())return null;
    const id=`reply:${taskId}`,existing=this.store.get<StoredReply>('integration_outbox',id);
    if(existing)return this.publicReply(existing);
    const connector=this.privateConnector(binding.connectorId),request=this.replyArguments(binding.replyTarget,text),now=this.stamp();
    const row:StoredReply={id,connectorId:binding.connectorId,taskId,status:this.canAutoReply(connector,request.tool)?'pending':'approval_required',attempts:0,lastError:null,createdAt:now,updatedAt:now,encryptedRequest:this.vault.seal({...request,target:binding.replyTarget})};
    this.store.put('integration_outbox',row);this.options.emit?.('connector.reply.updated',{outbox:this.publicReply(row)});
    return row.status==='pending'?this.deliverReply(id):this.publicReply(row);
  }
  async deliverReply(id:string):Promise<ReplyOutbox> {
    const pending=this.replies.get(id);if(pending)return pending;
    const row=this.storedReply(id);if(row.status==='sent')return this.publicReply(row);
    if(row.status==='sending'){
      const unknown={...row,status:'delivery_unknown' as const,lastError:'Previous delivery was interrupted; verify provider before retrying',updatedAt:this.stamp()};
      this.store.put('integration_outbox',unknown);return this.publicReply(unknown);
    }
    const job=(async()=>{
      let current=row;
      const save=(status:ReplyOutbox['status'],lastError:string|null)=>{
        current={...current,status,lastError,updatedAt:this.stamp()};this.store.put('integration_outbox',current);
        const value=this.publicReply(current);this.options.emit?.('connector.reply.updated',{outbox:value});return value;
      };
      try {
        const connector=this.active(row.connectorId),request=this.vault.open(row.encryptedRequest),target=request.target as ReplyTarget;
        if(target.kind!==connector.kind)throw new IntegrationError('Reply channel binding does not match connector',403);
        scoped(connector,this.receiveScope(connector.kind));
        scoped(connector,this.toolScope(connector.kind,request.tool));
        if(target.kind==='email') {
          const allowed=connector.config.allowedSenders;
          if(!Array.isArray(allowed)||!allowed.some(sender=>typeof sender==='string'&&sender.toLowerCase()===target.to.toLowerCase()))throw new IntegrationError('Reply recipient is not an allowed sender',403);
        }
        const auto=this.canAutoReply(connector,request.tool);
        if(!auto) {
          save('approval_required',null);
          // Approval belongs to the caller's separate manual runtime task.
          await this.approve(connector,request.tool,request.arguments);
        }
        current={...current,attempts:current.attempts+1};save('sending',null);
        await this.callInternal(connector.id,request.tool,request.arguments,{target,auto:true});
        return save('sent',null);
      }catch(error){
        if(error instanceof IntegrationError && error.statusCode===403 && current.status!=='sending')return save('approval_required',error.message);
        return save('failed',this.safeError(error));
      }
    })();
    this.replies.set(id,job);try{return await job;}finally{this.replies.delete(id);}
  }
  async retryReply(id:string):Promise<ReplyOutbox> {return this.deliverReply(id);}
  start(options:{emailPollMs?:number;outboxRetryMs?:number}={}):void {
    if(this.timers.length)return;
    for(const row of this.store.list<StoredReply>('integration_outbox'))if(row.status==='sending')this.store.put('integration_outbox',{...row,status:'delivery_unknown',lastError:'Previous delivery was interrupted; verify provider before retrying',updatedAt:this.stamp()});
    const poll=()=>{
      for(const connector of this.list())if(connector.kind==='email'&&connector.enabled&&connector.config.dotId&&connector.scopes.includes('mail:read')&&!this.polling.has(connector.id)) {
        if(this.missing('email',object(this.privateConnector(connector.id).config)).length)continue;
        const job=this.pollEmail(connector.id).catch(error=>{
          const old=this.store.get<StoredConnector>('connectors',connector.id),message=this.safeError(error);if(!old)return;
          if(old.state!=='error'||old.lastError!==message)this.setState(connector.id,'error',message);
        });
        this.polling.set(connector.id,job);void job.finally(()=>this.polling.delete(connector.id));
      }
    };
    const dispatch=()=>{
      // Retry pending work only. A network failure may have delivered a message;
      // failed/unknown work requires explicit user review before retry.
      for(const row of this.listOutbox())if(row.status==='pending'&&!this.replies.has(row.id)) {
        try{const c=this.active(row.connectorId);if(this.canAutoReply(c,this.getReplyRequest(row.id).tool))void this.deliverReply(row.id);}catch{}
      }
    };
    const emailMs=options.emailPollMs??30_000,outboxMs=options.outboxRetryMs??5_000;
    if(!Number.isFinite(emailMs)||emailMs<10||!Number.isFinite(outboxMs)||outboxMs<10)throw new IntegrationError('Polling intervals must be at least 10 ms');
    this.timers=[setInterval(poll,emailMs),setInterval(dispatch,outboxMs)];for(const timer of this.timers)timer.unref();poll();dispatch();
  }
  async stop():Promise<void> {
    for(const timer of this.timers)clearInterval(timer);this.timers=[];
    await Promise.allSettled([...this.polling.values(),...this.emailJobs.values(),...this.replies.values()]);
  }
  private privateVoiceSettings():VoiceSettings {
    const stored=this.store.get<{id:string;encryptedConfig:string}>('integration_voice','settings');
    return stored?this.vault.open(stored.encryptedConfig) as VoiceSettings:{...defaults};
  }
  getVoiceSettings():VoiceSettings {return redact(this.privateVoiceSettings());}
  /** Internal provider credential access for native voice; never expose as HTTP JSON. */
  getRealtimeConfiguration():{apiUrl:string;apiKey:string;model:string;voice:string;enabled:boolean} {
    const c=this.voice();return {apiUrl:endpoint(c.apiUrl),apiKey:required(c.apiKey,'voice apiKey'),model:required(c.realtimeModel??'gpt-realtime-1.5','realtimeModel'),voice:c.voice,enabled:true};
  }
  updateVoiceSettings(patch:Partial<VoiceSettings> & {baseUrl?:string}):VoiceSettings {
    const normalized={...object(patch)};if(normalized.baseUrl!==undefined){normalized.apiUrl=normalized.baseUrl;delete normalized.baseUrl;}
    const value=mergeConfig(this.privateVoiceSettings() as any,normalized) as VoiceSettings;
    endpoint(value.apiUrl);required(value.transcriptionModel,'transcriptionModel');required(value.speechModel,'speechModel');required(value.voice,'voice');
    if(!['mp3','wav','opus','aac','flac','pcm'].includes(value.format))throw new IntegrationError('Invalid audio format');
    if(value.followCodexVoice!==undefined&&typeof value.followCodexVoice!=='boolean')throw new IntegrationError('Invalid Codex voice preference');
    if(value.mode!==undefined&&!['auto','realtime','pipeline'].includes(value.mode))throw new IntegrationError('Invalid voice mode');
    if(value.transcriptionMode!==undefined&&!['auto','audio','chat'].includes(value.transcriptionMode))throw new IntegrationError('Invalid transcription mode');
    this.store.put('integration_voice',{id:'settings',encryptedConfig:this.vault.seal(value)});return this.getVoiceSettings();
  }
  /** Calls use the provider's Realtime API on OpenAI itself; any other OpenAI-compatible proxy uses the STT -> Dot model -> TTS pipeline. */
  voiceMode():'realtime'|'pipeline' {
    const c=this.privateVoiceSettings();if(c.mode==='realtime'||c.mode==='pipeline')return c.mode;
    try{return new URL(c.apiUrl).hostname==='api.openai.com'?'realtime':'pipeline';}catch{return 'realtime';}
  }
  private voice():VoiceSettings {
    const c=this.privateVoiceSettings();if(!c.enabled)throw new IntegrationError('Voice is disabled',409);
    required(c.apiKey,'voice apiKey');return c;
  }
  async transcribe(bytes:Buffer,filename='audio.webm',mimeType='audio/webm',hints:string[]=[]):Promise<{text:string}> {
    const c=this.voice();if(!bytes.length||bytes.length>25*1024*1024)throw new IntegrationError('Audio must be between 1 byte and 25 MB',413);
    if(this.transcriptionMode(c)==='chat')return this.transcribeWithChat(c,bytes,mimeType,hints);
    const form=new FormData();form.append('file',new Blob([new Uint8Array(bytes)],{type:mimeType}),filename);form.append('model',c.transcriptionModel);if(hints.length)form.append('prompt','Names and terms: '+hints.join(', ')+'.');form.append('response_format','json');if(c.language)form.append('language',c.language);
    const result=await json(this.ctx,`${c.apiUrl.replace(/\/$/,'')}/audio/transcriptions`,{method:'POST',headers:{authorization:`Bearer ${c.apiKey}`},body:form});
    if(typeof result.text!=='string')throw new IntegrationError('Transcription response has no text',502);return {text:result.text};
  }
  private transcriptionMode(c:VoiceSettings):'audio'|'chat' {
    if(c.transcriptionMode==='audio'||c.transcriptionMode==='chat')return c.transcriptionMode;
    return /whisper|transcribe|nova|scribe|parakeet|stt/i.test(c.transcriptionModel)?'audio':'chat';
  }
  private sttShapes=new Map<string,number>();
  /** Proxies without an STT provider can still transcribe with any chat model that accepts audio input. */
  private async transcribeWithChat(c:VoiceSettings,bytes:Buffer,mimeType:string,hints:string[]=[]):Promise<{text:string}> {
    const data=bytes.toString('base64'),mime=mimeType.split(';')[0]||'audio/wav',format=/mpeg|mp3/.test(mime)?'mp3':'wav';
    const prompt='Transcribe the speech in this audio verbatim, in the language that is spoken. Do not translate.'+(c.language?' The speaker most likely uses the language with code "'+c.language+'", but transcribe whatever language is actually spoken.':'')+' Output only the transcript, nothing else. Output exactly [silence] when the audio has no clear human speech: silence, background noise, breathing, coughing, typing, music or unintelligible sounds. Never invent words, never guess filler such as yes or okay, and never describe sounds or add notes in brackets.'+(hints.length?' The speaker is talking to an assistant and may use these names and terms: '+hints.join(', ')+'. When a spoken word sounds like one of them, even loosely (for example Nur, Nul or Nall for Null), write it exactly as listed, including a name at the start or end of a sentence. Spell all other words as spoken.':'');
    // Gateways disagree on how audio is attached to a chat message; the first accepted shape is remembered per model.
    const shapes:Record<string,unknown>[]=[{type:'input_audio',input_audio:{data,format}},{type:'image_url',image_url:{url:'data:'+mime+';base64,'+data}},{type:'file',file:{filename:'audio.'+format,file_data:'data:'+mime+';base64,'+data}}];
    const key=c.apiUrl+'|'+c.transcriptionModel,first=this.sttShapes.get(key)??0;let rejected=0;
    for(let k=0;k<shapes.length;k++){
      const index=(first+k)%shapes.length;
      const response=await this.ctx.fetch(endpoint(c.apiUrl.replace(/\/$/,'')+'/chat/completions'),{method:'POST',headers:{authorization:'Bearer '+c.apiKey,'content-type':'application/json'},body:JSON.stringify({model:c.transcriptionModel,temperature:0,max_tokens:2000,messages:[{role:'user',content:[{type:'text',text:prompt},shapes[index]]}]}),signal:AbortSignal.timeout(60_000),redirect:'error'});
      if(response.status===400||response.status===422){await response.body?.cancel();rejected++;continue;}
      if(!response.ok){await response.body?.cancel();throw new IntegrationError('Transcription provider HTTP '+response.status,502);}
      const text=chatCompletionText(await response.text());
      this.sttShapes.set(key,index);
      return {text:cleanTranscript(text)};
    }
    throw new IntegrationError('The transcription model rejected every audio format ('+rejected+' tried). Choose a model that accepts audio input.',502);
  }
  async speak(text:string,voice?:string):Promise<{audio:Buffer;mimeType:string}> {
    const c=this.voice();required(text,'text');if(text.length>4096)throw new IntegrationError('Speech text exceeds 4096 characters');
    const response=await this.ctx.fetch(endpoint(`${c.apiUrl.replace(/\/$/,'')}/audio/speech`),{method:'POST',headers:{authorization:`Bearer ${c.apiKey}`,'content-type':'application/json'},body:JSON.stringify({model:c.speechModel==='edge-tts'?'edge-tts/'+(voice??c.voice):c.speechModel,input:text,voice:voice??c.voice,response_format:c.format}),signal:AbortSignal.timeout(60_000),redirect:'error'});
    if(!response.ok)throw new IntegrationError(`Speech provider HTTP ${response.status}`,502);
    const audio=Buffer.from(await response.arrayBuffer());if(!audio.length)throw new IntegrationError('Speech provider returned empty audio',502);
    const mimeType=response.headers.get('content-type')?.split(';')[0]??({mp3:'audio/mpeg',wav:'audio/wav',opus:'audio/ogg',aac:'audio/aac',flac:'audio/flac',pcm:'audio/pcm'}[c.format]);
    if(!mimeType.startsWith('audio/')&&mimeType!=='application/octet-stream')throw new IntegrationError('Speech provider did not return audio',502);
    return {audio,mimeType};
  }
}
