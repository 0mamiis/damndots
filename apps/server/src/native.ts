import { fileURLToPath } from 'node:url';
import { voiceVocabulary } from './voice-text.js';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import {readFile,stat,realpath} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import type { Dot, Message, RecordStore, Task, RunInput } from '@dots/contracts';
import type { ServerConfig } from './config.js';
import { bearer, type AuthService } from './auth.js';
import type { OrbitRuntime } from './runtime/index.js';
import { RpcClient } from './runtime/index.js';
import type { BlobStore } from './blobs.js';
import type { WorkerBroker } from './workers.js';
import type { IntegrationService } from './integrations/index.js';
import type { ExternalEvents } from './events.js';
import { registerNativeVoice, OpenAICompatibleRealtimeProvider, type NativeVoiceService } from './native-voice.js';
import { ModalRealtimeProvider, PipelineRealtimeProvider } from './voice-pipeline.js';
import { VoicePeerHost } from './voice-peer.js';
import { CodexSpeech } from './codex-speech.js';
import { resolve } from 'node:path';
import { DotTools } from './tools.js';
import { registerBrowserViewer } from './viewer.js';
import { dotBrowserSession } from './browser-session.js';
import {ComputerTransport} from './computer-transport.js';
import {SecretVault} from './integrations/security.js';
import {modelProxy} from './model-proxy.js';
import type {ProviderService} from './providers.js';
import {nativeAutomation,registerNativeAutomations} from './native-automations.js';
import {routeNativeRpc} from './rpc-routing.js';
import {selectNativePrimary,setNativePrimary,visibleNativeDots,type NativePrimary} from './native-selection.js';
import {resolveNativeAlias} from './native-aliases.js';
export interface NativeContext {config:ServerConfig;providers:ProviderService;store:RecordStore;runtime:OrbitRuntime;auth:AuthService;blobs:BlobStore;workers:WorkerBroker;integrations:IntegrationService;external:ExternalEvents;}
const primary=(ctx:NativeContext)=>selectNativePrimary(ctx.store,ctx.runtime.listDots());
/** Profil ve sohbet odası aynı ikon bilgisini taşımalı; uygulama oda verisiyle profil önbelleğini günceller. */
const avatarFields=(d:Dot)=>{const manifest:any=d.avatarManifest;return {avatar_type:manifest?(manifest.pet_id?'codex-pet':'rendered-interactive'):'default',avatar_url:d.avatarUrl,avatar_manifest:d.avatarManifest};};
const profile=(d:Dot)=>({id:d.id,display_name:d.name,name:d.name,status:'active',aeon_kind:'orbit',is_paused:d.paused,root_thread_id:d.rootThreadId,active_root_thread_id:d.rootThreadId,messaging_room_id:d.messagingRoomId,avatar:'custom',...avatarFields(d),created_at:d.createdAt,updated_at:d.updatedAt});
export async function computerAppearance(ctx:NativeContext,dot:Dot){let avatarImage:string|null=null;const pointer=dot.avatarUrl;if(pointer?.startsWith('file-service://')){try{const bytes=await ctx.blobs.read(pointer.slice(15));if(bytes.length<2*1024*1024)avatarImage='data:image/png;base64,'+bytes.toString('base64');}catch{}}return {name:dot.name,avatarManifest:dot.avatarManifest,avatarImage};}
const nativeAttachment=(a:any)=>({type:'file',file_id:a.id,id:a.id,name:a.name,mime_type:a.mimeType,size_bytes:a.size,status:'ready'});
const nativeMessage=(m:Message,d:Dot,outputs:any[]=[])=>{const attachments=m.attachments.map(nativeAttachment);if(m.role==='user')return {id:m.id,room_id:d.messagingRoomId,account_user_id:'user_local_orbit',content:{text:m.text,attachments},request_id:m.requestId,created_at:m.createdAt};const links:Record<string,string>={},extra:string[]=[];for(const o of outputs.filter(o=>o.taskId===m.taskId)){const path='/mnt/data/'+o.id+'/'+o.name;links[path]=o.id;extra.push(`[${o.name}](sandbox:${path})`);attachments.push(nativeAttachment(o));}const text=m.text+(extra.length?'\n\n'+extra.join('\n'):'');return {id:m.id,room_id:d.messagingRoomId,created_at:m.createdAt,raw_messages:[{id:'raw_'+m.id,author:{role:m.role,name:d.name},channel:'final',create_time:Date.parse(m.createdAt)/1000,content:{content_type:'text',parts:[text]},metadata:{code_interpreter_file_links:links}}],attachments};};
const djb2=(s:string)=>{let t=0;for(const c of s)t=(t<<5)-t+c.charCodeAt(0)|0;return String(t>>>0);};
const nativeActivity=(ctx:NativeContext,dotId:string)=>{const map=new Map<string,unknown>();for(const t of ctx.runtime.listTasks({dotId}).sort((a,b)=>a.updatedAt.localeCompare(b.updatedAt))){if(!t.threadId||t.threadId.startsWith('tool:')||ctx.store.get('voice_tasks',t.id))continue;map.set(t.threadId,{thread_id:t.threadId,parent_thread_id:t.parentTaskId?ctx.runtime.getTask(t.parentTaskId).threadId:null,title:t.title,image_url:null,emoji:null,status:['running','waiting_approval'].includes(t.status)?'in_progress':['completed','failed','cancelled','interrupted'].includes(t.status)?'completed':null,outcome:t.status==='completed'?'succeeded':t.status==='failed'?'failed':['cancelled','interrupted'].includes(t.status)?'interrupted':null,created_at:Date.parse(t.createdAt)/1000,updated_at:Date.parse(t.updatedAt)/1000,preview:t.turnId?{turn_id:t.turnId,text:t.result||t.error||null,image:null}:null});}return [...map.values()];};
export async function registerNative(app:FastifyInstance,ctx:NativeContext){
  const {runtime,auth,store,config,blobs,workers,integrations}=ctx;
  const sockets=new Set<{ws:WebSocket;topics:Set<string>}>();let offset=0;
  let voice:NativeVoiceService|undefined;
  const voiceHost=new VoicePeerHost();
  const codexSpeech=new CodexSpeech({host:voiceHost,nativeDir:join(resolve(process.env.DOTS_STACK_DIR||fileURLToPath(new URL('../../../.data/local-stack',import.meta.url))),'native')});
  app.addHook('onClose',async()=>{await codexSpeech.shutdown();await voiceHost.shutdown();});
  const rootRepairs=new Map<string,Promise<Dot>>();
  const ensureRoot=(dot:Dot):Promise<Dot>=>{const pending=rootRepairs.get(dot.id);if(pending)return pending;const job=(async()=>{const rpc=new RpcClient({url:store.get<any>('settings','owner')?.appServerUrl||config.appServerUrl});try{await rpc.connect();await rpc.request('initialize',{clientInfo:{name:'dots_native_root',version:'0.1.0'},capabilities:{experimentalApi:true}});rpc.notify('initialized');if(dot.rootThreadId){const remote=runtime.listTasks({dotId:dot.id}).find(t=>t.threadId===dot.rootThreadId&&t.computerId);if(remote)return dot;try{await rpc.request('thread/read',{threadId:dot.rootThreadId,includeTurns:false});return dot;}catch{try{await rpc.request('thread/resume',{threadId:dot.rootThreadId});return dot;}catch(e){if(!/not found|not loaded|missing|no rollout|does not exist/i.test((e as Error).message))throw e;}}}
    const tools=new DotTools(()=>runtime,()=>integrations,workers,store),defs=await tools.list({dot,task:{id:'repair-'+dot.id} as Task,memories:[]} as RunInput);const history=runtime.listMessages(dot.id).slice(-80).map(m=>`${m.role}: ${m.text}`).join('\n\n');const r=await rpc.request<any>('thread/start',{model:dot.model,cwd:join(config.dataDir,'workspaces'),developerInstructions:[dot.instructions,history?'Previous conversation retained from this dot:\n'+history:''].filter(Boolean).join('\n\n'),dynamicTools:defs.map(t=>({type:'function',name:t.name,description:t.description,inputSchema:t.inputSchema}))});if(dot.rootThreadId)store.put('native_thread_aliases',{id:dot.rootThreadId,dotId:dot.id});store.put('thread_tool_versions',{id:r.thread.id,version:1});const updated=store.put('dots',{...runtime.getDot(dot.id),rootThreadId:r.thread.id,updatedAt:new Date().toISOString()});runtime.activity(dot.id,null,'thread.repaired','Native root prepared with retained conversation',{oldThreadId:dot.rootThreadId,threadId:r.thread.id});return updated;
    }finally{rpc.close();}})().finally(()=>rootRepairs.delete(dot.id));rootRepairs.set(dot.id,job);return job;};
  const push=(topic_id:string,payload:unknown)=>{offset++;for(const c of sockets)if(c.topics.has(topic_id)&&c.ws.readyState===WebSocket.OPEN)c.ws.send(JSON.stringify([{topic_id,type:'message',offset:String(offset),payload}]));};
  const liveRevs=new Map<string,number>(),liveSubs=new Map<string,string>();
  const unsubscribe=runtime.subscribe(e=>{
    const dot=e.dotId?runtime.listDots().find(d=>d.id===e.dotId):undefined;if(!dot)return;
    if(e.type==='dot.updated'&&dot.computerId){try{const computer=workers.get(dot.computerId);if(computer.state==='online'&&computer.capabilities.includes('desktop')){const session=dotBrowserSession(store,dot.id,computer.id);void computerAppearance(ctx,dot).then(appearance=>workers.queue(computer.id,'desktop',{action:'appearance',sessionId:session.sessionId,dotId:dot.id,appearance,actor:'agent'})).catch(()=>{});}}catch{}}
    if(e.type==='message.created'){const m=e.data.message as Message|undefined;if(m)push('calpico-chatgpt-messaging',{type:'calpico-message-add',payload:{room_id:dot.messagingRoomId,message:{id:m.id,role:m.role}}});}
    if(e.type==='task.updated'){const task=e.data.task as any;if(!task)return;const rev=(liveRevs.get(dot.messagingRoomId)||0)+1;liveRevs.set(dot.messagingRoomId,rev);push('calpico-room-live:'+dot.messagingRoomId,{type:'calpico-room-live',payload:{type:'calpico-room-live-state',version:1,room_id:dot.messagingRoomId,subscription_id:liveSubs.get(dot.messagingRoomId)||'sub_local',revision:rev,threads:[{thread_id:task.threadId||dot.rootThreadId,stream_state:'attached',turn_id:task.turnId,turn_status:['running','waiting_approval'].includes(task.status)?'in_progress':'completed'}]}});}
  });
  const requireNative=async(req:any,reply:any)=>{const p=req.url.split('?')[0];let c=auth.verify(bearer(req.headers.authorization),['native']);if(c?.refresh)c=undefined;
    if(!c&&p.includes('/files/content/')){const token=req.query.t;const file=auth.verify(token,['file']);if(file?.fileId===req.params.id)c=file;}
    if(!c)return reply.code(401).send({detail:'unauthorized'});req.nativeClientId=c.sub;
    const route=req.routeOptions.url||'';
    if(req.params?.id&&(route.startsWith('/backend-api/tbo/:id')||route.startsWith('/backend-api/cloud-aeons/:id'))){
      const alias=resolveNativeAlias(store,'native_dot_aliases',req.params.id);if(alias)req.params.id=alias.id;
    }
  };
  const requireWs=async(req:any,reply:any)=>{const c=auth.verify(bearer(req.headers.authorization),['native'])||(req.url.startsWith('/native/pubsub')?auth.verify(req.query.t,['pubsub']):undefined);if(!c||c.refresh)return reply.code(401).send({error:'Native authentication required'});};
  app.get('/native/pubsub',{websocket:true,preValidation:requireWs},ws=>{const c={ws,topics:new Set<string>()};sockets.add(c);ws.on('message',bytes=>{let arr:any;try{arr=JSON.parse(bytes.toString());}catch{return;}if(!Array.isArray(arr))return;const replies=[];for(const item of arr.slice(0,100)){const cmd=item.command;if(!cmd)continue;if(cmd.type==='subscribe'){c.topics.add(cmd.topic_id);replies.push({id:item.id,reply:{type:'subscribe',topic_id:cmd.topic_id,recovered:false,last_offset:String(offset)}});}else{if(cmd.type==='unsubscribe')c.topics.delete(cmd.topic_id);replies.push({id:item.id,reply:{}});}}ws.send(JSON.stringify(replies));});ws.on('close',()=>sockets.delete(c));});
  app.get('/native/app-server',{websocket:true,preValidation:requireWs},(socket,req)=>{
    const upstream=new WebSocket(store.get<any>('settings','owner')?.appServerUrl||config.appServerUrl),queued:{data:Buffer;binary:boolean}[]=[];
    const controller=new AbortController();socket.once('close',()=>controller.abort());
    socket.on('message',(data,binary)=>{const b=Buffer.from(data as Buffer);let msg:any;try{msg=JSON.parse(b.toString());}catch{}
      if(voice&&msg?.method?.startsWith('thread/realtime/')){void voice.handleRpc(msg.method,msg.params||{},(method,params)=>socket.send(JSON.stringify({method,params}))).then(result=>socket.send(JSON.stringify({id:msg.id,result}))).catch(e=>socket.send(JSON.stringify({id:msg.id,error:{code:-32603,message:e.message}})));return;}
      if(msg?.method&&msg.params?.threadId){void routeNativeRpc(msg,{store,workers},controller.signal).then(result=>{if(socket.readyState!==WebSocket.OPEN)return;if(result.handled)socket.send(JSON.stringify({id:msg.id,result:result.result}));else if(upstream.readyState===WebSocket.OPEN)upstream.send(b,{binary});else queued.push({data:b,binary});}).catch(error=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({id:msg.id,error:{code:-32603,message:error.message}}));});return;}
      if(upstream.readyState===WebSocket.OPEN)upstream.send(b,{binary});else if(queued.length<100)queued.push({data:b,binary});else socket.close(1008,'Request queue full');});
    upstream.on('open',()=>{for(const b of queued)upstream.send(b.data,{binary:b.binary});queued.length=0;});upstream.on('message',(data,binary)=>{if(socket.readyState===WebSocket.OPEN)socket.send(data,{binary});});upstream.on('error',()=>socket.close(1011,'App-server unavailable'));upstream.on('close',()=>socket.close());socket.on('close',()=>upstream.close());
  });
  app.post('/auth/oauth/token',async(req,reply)=>{const b=req.body as any;const refresh=auth.verify(b?.refresh_token,['native']);if(!refresh?.refresh)return reply.code(401).send({error:'invalid_grant'});return auth.nativeTokens(refresh.sub);});
  app.post('/auth/oauth/revoke',async(req,reply)=>{const b=req.body as any,c=auth.verify(b?.token,['native']);if(c)auth.revokeIdentity(c.sub);return {};});
  app.get('/auth/oauth/authorize',async(req,reply)=>reply.code(403).send({error:'Use the self-hosted client enrollment workflow'}));
  await app.register(async api=>{
    api.addHook('preHandler',requireNative);
    registerBrowserViewer(api,ctx);
    registerNativeAutomations(api,ctx);
    voice=registerNativeVoice(api,{runtime,registerLifecycle:false,provider:new ModalRealtimeProvider(new OpenAICompatibleRealtimeProvider({configuration:()=>integrations.getRealtimeConfiguration()}),new PipelineRealtimeProvider({host:voiceHost,configuration:()=>integrations.getRealtimeConfiguration(),transcribe:async wav=>(await integrations.transcribe(wav,'speech.wav','audio/wav',voiceVocabulary(runtime))).text,speak:async(text,signal,callId)=>integrations.getVoiceSettings().followCodexVoice&&callId?codexSpeech.speak(callId,text,signal):integrations.speak(text),closeSpeaker:id=>codexSpeech.close(id),prepareSpeaker:async id=>{if(integrations.getVoiceSettings().followCodexVoice)await codexSpeech.warm(id);}}),()=>integrations.voiceMode()),emit:(t,d,dotId,taskId)=>ctx.external.publish(t,d,dotId,taskId),onTranscript:(dotId,role,text,callId,itemId)=>{const id='voice_'+callId+'_'+itemId+'_'+role;if(store.get('messages',id))return;const m={id,dotId,role,text,attachments:[],taskId:null,channel:'voice',requestId:itemId,createdAt:new Date().toISOString()};store.put('messages',m);ctx.external.publish('message.created',{message:m},dotId);}});
    api.get('/wham/accounts/check',async()=>({accounts:[{id:'acct_local_orbit',account_user_id:'user_local_orbit',account_user_role:'account-owner',structure:'personal',plan_type:'pro',is_zdr:false,is_openai_internal:false,can_access_with_session:true,enable_account_switching:false,name:'Personal',workspace_backend_origin:'NO_CONSTRAINT',account_routing_override:'NO_CONSTRAINT'}],default_account_id:'acct_local_orbit',account_ordering:['acct_local_orbit']}));
    api.get('/accounts/check/:id',async()=>({accounts:{acct_local_orbit:{account:{account_id:'acct_local_orbit',account_user_id:'user_local_orbit',account_user_role:'account-owner',structure:'personal',plan_type:'pro',is_zdr:false,tbo_config:{tbo_available:true}},can_access_with_session:true,sso_connection_name:null,features:[]}},account_ordering:['acct_local_orbit']}));
    api.get('/accounts/:id/settings',async()=>({beta_settings:{},permissions:[]}));
    // 3085093835 is the installed app's native navigation rail gate (NF/e0r).
    // Leaving it out makes the Dots session fall back to the legacy sidebar.
    api.post('/wham/statsig/bootstrap',async req=>{const body=req.body as any,gates:Record<string,unknown>={};for(const k of ['codex-app-side-orb-enabled','codex-app-aeon-local-mode','codex-app-aeon-cloud-mode','codex-app-aeon-cloud-mode-no-executor','775990392','970190263','2963628453','3085093835']){const id=/^\d+$/.test(k)?k:djb2(k);gates[id]={name:id,value:true,rule_id:'self-hosted',secondary_exposures:[],id_type:'userID'};}return {statsigPayload:JSON.stringify({feature_gates:gates,dynamic_configs:{},layer_configs:{},param_stores:{},sdkParams:{},has_updates:true,generator:'self-hosted',time:Date.now(),company_lcut:Date.now(),evaluated_keys:{userID:'user_local_orbit'},hash_used:'djb2',derived_fields:{},user:{userID:'user_local_orbit',customIDs:{stableID:body.stable_id||'local',account_id:'acct_local_orbit'},email:'orbit@local.test',appVersion:body.app_version,custom:{plan_type:'pro',codex_build_flavor:body.build_flavor}}})};});
    api.post('/codex/analytics-events/events',async()=>({}));api.get('/settings/user',async()=>({}));api.get('/wham/tasks/list',async()=>({items:[],cursor:null}));
    api.get('/tbo',async()=>({items:visibleNativeDots(store,runtime.listDots()).map(profile),cursor:null}));
    api.post('/tbo',async req=>{
      const b=req.body as any,s=store.get<any>('settings','owner')||{},previous=primary(ctx);
      const d=runtime.createDot({name:b.display_name||'dot',model:null,reasoningEffort:null,serviceTier:null,avatarUrl:b.avatar_url||b.avatar_manifest?.snapshot?.asset_pointer||null,avatarManifest:b.avatar_manifest||null});
      const rpc=new RpcClient({url:s.appServerUrl||config.appServerUrl});
      try{
        await rpc.connect();await rpc.request('initialize',{clientInfo:{name:'dots-server',version:'0.1.0'},capabilities:{experimentalApi:true}});rpc.notify('initialized');
        const tools=new DotTools(()=>runtime,()=>integrations,workers,store),definitions=await tools.list({dot:d,task:{id:'initialize-'+d.id} as Task,memories:[]} as RunInput);
        const r=await rpc.request<any>('thread/start',{threadSource:'aeon',model:s.model||config.model,cwd:join(config.dataDir,'workspaces'),config:{model_reasoning_effort:s.reasoningEffort||config.reasoningEffort},serviceTier:s.serviceTier??config.serviceTier,dynamicTools:definitions.map(t=>({type:'function',name:t.name,description:t.description,inputSchema:t.inputSchema}))});
        store.put('thread_tool_versions',{id:r.thread.id,version:DotTools.VERSION});store.put('dots',{...runtime.getDot(d.id),rootThreadId:r.thread.id});
      }catch(error){runtime.deleteDot(d.id);throw error;}finally{rpc.close();}
      if(!previous||b.create_additional===false)setNativePrimary(store,runtime.getDot(d.id));
      return profile(runtime.getDot(d.id));
    });
    const selection=async()=>{
      let d=primary(ctx);
      for(let attempt=0;d&&attempt<3;attempt++){
        const ready=await ensureRoot(d),current=primary(ctx);
        if(current?.id===ready.id){d=runtime.getDot(ready.id);break;}
        d=current;
      }
      const saved=store.get<NativePrimary>('native_meta','primary');
      return {selection:d?{thread_id:d.rootThreadId,generation:String(saved?.generation||1),selected_at:saved?.selectedAt||d.createdAt,aeon_id:d.id,available:!!d.rootThreadId,messaging_room_id:d.messagingRoomId}:null};
    };
    api.get('/tbo/primary',async()=>selection());api.get('/cloud-aeons/primary',async()=>selection());
    api.put('/tbo/primary',async req=>{const b=req.body as any,d=runtime.getDot(b.tbo_id);if(store.get('native_hidden_dots',d.id))throw Object.assign(new Error('Dot is archived'),{statusCode:404});setNativePrimary(store,d);return selection();});
    api.put('/cloud-aeons/primary',async req=>{const b=req.body as any,d=visibleNativeDots(store,runtime.listDots()).find(d=>d.rootThreadId===b.thread_id);if(!d)throw Object.assign(new Error('Dot not found'),{statusCode:404});setNativePrimary(store,d);return selection();});
    api.get('/tbo/by-thread/:id',async req=>{const id=(req.params as any).id,d=runtime.listDots().find(d=>d.rootThreadId===id)||runtime.listTasks().find(t=>t.threadId===id)||store.get<{dotId:string}>('native_thread_aliases',id);if(!d)throw Object.assign(new Error('Dot not found'),{statusCode:404});return profile('dotId'in d?runtime.getDot(d.dotId):d);});
    api.get('/tbo/:id',async req=>profile(runtime.getDot((req.params as any).id)));
    const patch=async(req:any)=>{const b=req.body,id=req.params.id;const d=runtime.getDot(id);const cleared=b.avatar_manifest===null||b.avatar_type==='default';return profile(runtime.updateDot(id,{name:b.display_name??b.name??d.name,avatarManifest:cleared?null:b.avatar_manifest,avatarUrl:cleared?null:b.avatar_url??b.avatar_manifest?.snapshot?.asset_pointer}));};
    api.patch('/tbo/:id',patch);api.patch('/cloud-aeons/:id',patch);api.delete('/tbo/:id',async req=>{runtime.deleteDot((req.params as any).id);return {};});
    api.post('/cloud-aeons/avatar-snapshots',async req=>{const file=await req.file();if(!file)throw Object.assign(new Error('Snapshot required'),{statusCode:400});const a=await blobs.put(await file.toBuffer(),file.filename,file.mimetype);return {snapshot:{schema_version:1,asset_pointer:'file-service://'+a.id}};});
    api.get('/tbo/:id/threads',async req=>{const d=runtime.getDot((req.params as any).id);const ids=new Set([d.rootThreadId,...runtime.listTasks({dotId:d.id}).map(t=>t.threadId)].filter(Boolean));return {items:[...ids].map(thread_id=>({thread_id,tbo_id:d.id,hidden:false,created_at:d.createdAt})),cursor:null};});
    api.get('/tbo/:id/root-thread',async req=>({root_thread_id:runtime.getDot((req.params as any).id).rootThreadId}));api.post('/tbo/:id/messaging-room',async req=>({messaging_room_id:runtime.getDot((req.params as any).id).messagingRoomId}));
    api.post('/tbo/:id/runtime/pause',async req=>{const d=runtime.pauseDot((req.params as any).id);return {thread_id:d.rootThreadId,status:'applied'};});api.post('/tbo/:id/runtime/resume',async req=>{const d=runtime.resumeDot((req.params as any).id);return {thread_id:d.rootThreadId,status:'applied'};});
    api.post('/tbo/:id/computer/sessions',async(req,reply)=>{
      // Resmi canlı bilgisayar görünümü: panel WebRTC teklifini gönderir, bilgisayardaki worker cevaplar.
      const id=(req.params as any).id,dot=runtime.getDot(id),offer=typeof req.body==='string'?req.body.trim()+'\r\n':'';
      if(!offer.startsWith('v=0')||offer.length>65536)throw Object.assign(new Error('A WebRTC session offer is required'),{statusCode:400});
      const computer=dot.computerId?workers.get(dot.computerId):workers.list().find(c=>c.state==='online'&&c.capabilities.includes('browser'));
      if(!computer||computer.state!=='online'||!computer.capabilities.includes('browser'))throw Object.assign(new Error('Connect an online browser computer first'),{statusCode:409});
      const session=dotBrowserSession(store,id,computer.id),controller=new AbortController(),timeout=setTimeout(()=>controller.abort(new Error('The computer did not answer in time')),20000);
      try{const result=await workers.execute(computer.id,'stream',{action:'offer',sessionId:session.sessionId,dotId:id,offer,iceServers:new ComputerTransport(store,new SecretVault(config.signingKey)).iceServers(),...computer.capabilities.includes('desktop')?{appearance:await computerAppearance(ctx,dot)}:{}},undefined,controller.signal);
        return reply.type('application/sdp').header('cache-control','no-store').header('x-request-id',session.sessionId).send(String(result.sdp));}
      finally{clearTimeout(timeout);}
    });
    api.get('/tbo/:id/environment/status',async req=>{const d=runtime.getDot((req.params as any).id),c=d.computerId?workers.get(d.computerId):workers.list()[0];const patched=req.headers['x-dots-client-capabilities']==='browser-viewer-v1';return {environmentId:c?.id||null,status:c?.state==='online'?'running':'unknown',capabilities:[...(c?.capabilities||[]).filter(type=>!['remote_desktop','desktop'].includes(type)).map(type=>({type,status:c?.state==='online'?'ready':'unavailable'})),...patched&&c?.state==='online'&&c.capabilities.includes('browser')?[{type:'remote_desktop',status:'ready'}]:[]]};});
    api.get('/tbo/:id/computers',async req=>{const d=runtime.getDot((req.params as any).id);return {thread_id:d.rootThreadId,computers:workers.list().map(c=>({kind:'user',environment_id:c.id,display_name:c.name,status:c.state==='online'?'connected':'offline',is_attached:d.computerId===c.id,can_connect:c.state==='online',can_disconnect:d.computerId===c.id})),local_computer_access_disabled_by_admin:false};});
    const computerChange=async(req:any,attach:boolean)=>{const d=runtime.getDot(req.params.id);if(req.query.expected_thread_id&&d.rootThreadId!==req.query.expected_thread_id)throw Object.assign(new Error('Dot root changed; refresh profile'),{statusCode:409});workers.get(req.params.environmentId);const next=runtime.updateDot(d.id,{computerId:attach?req.params.environmentId:null});return {thread_id:next.rootThreadId,status:'applied'};};
    api.post('/tbo/:id/computers/:environmentId/connect-and-replace',async req=>computerChange(req,true));api.post('/tbo/:id/computers/:environmentId/disconnect',async req=>computerChange(req,false));
    api.get('/tbo/:id/activity',async req=>({data:nativeActivity(ctx,(req.params as any).id),next_cursor:null}));
    api.get('/tbo/:id/activity/stream',async(req,reply)=>{const dotId=(req.params as any).id;reply.hijack();reply.raw.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});reply.raw.write('event: snapshot\ndata: '+JSON.stringify({data:nativeActivity(ctx,dotId),next_cursor:null})+'\n\n');const off=runtime.subscribe(e=>{if(e.dotId===dotId&&e.type==='task.updated')reply.raw.write('event: snapshot\ndata: '+JSON.stringify({data:nativeActivity(ctx,dotId),next_cursor:null})+'\n\n');});const timer=setInterval(()=>reply.raw.write(': heartbeat\n\n'),15000);reply.raw.on('close',()=>{off();clearInterval(timer);});});
    api.get('/tbo/:id/automations',async req=>({items:runtime.listSchedules((req.params as any).id).map(s=>nativeAutomation(ctx,s)),cursor:null}));
    api.get('/celsius/ws/user',async req=>({websocket_url:'wss://ws.chatgpt.com/celsius/ws?t='+auth.issue('pubsub',(req as any).nativeClientId,600)}));
    const room=(id:string)=>{const d=runtime.listDots().find(d=>d.messagingRoomId===id)||resolveNativeAlias(store,'native_room_aliases',id);if(!d)throw Object.assign(new Error('Room not found'),{statusCode:404});return d;};
    api.get('/messaging/rooms/:id',async req=>{const d=room((req.params as any).id),members=[{id:'member_user_'+d.id,account_user_id:'user_local_orbit',name:'You',username:'you',avatar_url:null,avatar_file_id:null},{id:'member_aeon_'+d.id,account_user_id:'aeonuser_'+d.id,aeon_id:d.id,name:d.name,username:'dot',...avatarFields(d),avatar_file_id:null}];return {id:d.messagingRoomId,type:'DM',app_source:'chatgpt:messaging',aeon_id:d.id,members,member_profile_snapshots:members.map(m=>({account_user_id:m.account_user_id,name:m.name,username:m.username})),latest_messages:runtime.listMessages(d.id).slice(-20).map(m=>nativeMessage(m,d)),last_read_at:null,read_receipts:[],created_at:d.createdAt,updated_at:d.updatedAt};});
    api.get('/messaging/rooms/:id/messages',async req=>{const d=room((req.params as any).id);return {items:runtime.listMessages(d.id).map(m=>nativeMessage(m,d,runtime.listOutputs({dotId:d.id}))),prev_cursor:null,next_cursor:null};});
    api.post('/messaging/rooms/:id/files',async req=>{const d=room((req.params as any).id),part=await req.file();if(!part)throw Object.assign(new Error('File required'),{statusCode:400});const a=await blobs.put(await part.toBuffer(),part.filename,part.mimetype,d.id);return nativeAttachment(a);});
    api.get('/messaging/rooms/:id/files/:fileId',async req=>{const d=room((req.params as any).id),a=blobs.forDot((req.params as any).fileId,d.id);return {...nativeAttachment(a),download_url:'https://localhost:8000/backend-api/files/content/'+a.id+'?t='+auth.issue('file',(req as any).nativeClientId,300,{fileId:a.id}),library_file_id:null};});
    api.post('/messaging/rooms/:id/messages',async req=>{const d=room((req.params as any).id),b=req.body as any;const attachments=(b.content?.attachments||[]).map((a:any)=>blobs.forDot(a.id||a.file_id,d.id));const {message}=runtime.submitMessage(d.id,{text:b.content?.text||'',attachments,requestId:b.request_id,channel:'chatgpt'});return nativeMessage(message,d);});
    api.post('/messaging/rooms/:id/read',async()=>({last_read_at:new Date().toISOString()}));api.post('/messaging/rooms/:id/responding_heartbeat',async()=>({}));
    api.post('/messaging/rooms/:id/aeon/prepare',async(req,reply)=>{const d=room((req.params as any).id);return reply.code(204).header('x-openai-thread-route','local-'+d.id).send();});
    api.post('/messaging/rooms/:id/live',async(req,reply)=>{const d=room((req.params as any).id),subscription_id='sub_'+randomUUID();liveSubs.set(d.messagingRoomId,subscription_id);reply.hijack();reply.raw.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});reply.raw.write('data: '+JSON.stringify({type:'calpico-room-live-ready',version:1,room_id:d.messagingRoomId,subscription_id})+'\n\n');const timer=setInterval(()=>reply.raw.write(': keepalive\n\n'),15000);reply.raw.on('close',()=>{clearInterval(timer);if(liveSubs.get(d.messagingRoomId)===subscription_id)liveSubs.delete(d.messagingRoomId);});});
    api.get('/files/download/:id',async(req,reply)=>{const id=(req.params as any).id;try{blobs.get(id);}catch{runtime.getOutput(id);}return {status:'success',download_url:'https://localhost:8000/backend-api/files/content/'+id+'?t='+auth.issue('file',(req as any).nativeClientId,300,{fileId:id}),file_name:'output',mime_type:'application/octet-stream'};});
    api.get('/files/content/:id',async(req,reply)=>{const id=(req.params as any).id;let a;try{a=blobs.get(id);}catch{const o=runtime.getOutput(id);if(o.computerId){const r=await workers.execute(o.computerId,'filesystem',{action:'read',path:o.path});return reply.type(o.mimeType).send(Buffer.from(r.data,'base64'));}const root=await realpath(join(config.dataDir,'workspaces')),path=await realpath(o.path),rel=relative(root,path);if(rel.startsWith('..')||isAbsolute(rel))throw Object.assign(new Error('Output path outside workspace'),{statusCode:403});if((await stat(path)).size>32*1024*1024)throw Object.assign(new Error('Output too large'),{statusCode:413});return reply.type(o.mimeType).send(await readFile(path));}return reply.type(a.mimeType).send(await blobs.read(id));});
    api.all('/codex/*',async(req,reply)=>modelProxy(req,reply,ctx.providers,(req.params as any)['*']));
    const connectors=()=>integrations.list().map(c=>({id:c.id,name:c.name,description:c.kind,enabled:c.enabled,status:c.state}));
    api.post('/aip/connectors/batch',async()=>({connectors:connectors()}));api.post('/aip/connectors/links/list_accessible',async()=>({links:[]}));api.get('/connectors/directory/list',async()=>({objects:connectors(),items:connectors(),connectors:connectors(),next_token:null,cursor:null}));api.get('/ps/plugins/*',async()=>({items:[],plugins:[],cursor:null}));
    api.post('/ps/mcp',async(req,reply)=>{const msg=req.body as any;if(msg.id===undefined)return reply.code(202).send();if(msg.method==='initialize')return {jsonrpc:'2.0',id:msg.id,result:{protocolVersion:msg.params?.protocolVersion||'2025-03-26',capabilities:{tools:{listChanged:true}},serverInfo:{name:'dots-apps',version:'0.1.0'}}};if(msg.method==='ping')return {jsonrpc:'2.0',id:msg.id,result:{}};
      if(msg.method==='tools/list'){const tools=[];for(const c of integrations.list().filter(c=>c.enabled)){for(const t of await integrations.tools(c.id).catch(()=>[]))tools.push({...t,name:'app_'+c.id.replaceAll('-','')+'_'+t.name});}return {jsonrpc:'2.0',id:msg.id,result:{tools}};}
      if(msg.method==='tools/call'){const c=integrations.list().find(c=>String(msg.params?.name).startsWith('app_'+c.id.replaceAll('-','')+'_'));if(!c)return {jsonrpc:'2.0',id:msg.id,error:{code:-32602,message:'Unknown app tool'}};try{const value=await integrations.call(c.id,msg.params.name.slice(('app_'+c.id.replaceAll('-','')+'_').length),msg.params.arguments||{});return {jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:JSON.stringify(value)}]}};}catch(e){return {jsonrpc:'2.0',id:msg.id,result:{isError:true,content:[{type:'text',text:(e as Error).message}]}};}}
      return {jsonrpc:'2.0',id:msg.id,result:{resources:[],resourceTemplates:[]}};});api.get('/ps/mcp',async(req,reply)=>reply.code(405).header('Allow','POST').send());
  },{prefix:'/backend-api'});
  app.addHook('onReady',async()=>voice?.recover());
  app.addHook('onClose',async()=>{await voice?.close();unsubscribe();for(const c of sockets)c.ws.close();});
}
