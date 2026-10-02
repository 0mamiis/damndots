import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { RecordStore } from '@dots/contracts';
import { IntegrationService } from '../src/integrations/index.js';

class MemoryStore implements RecordStore {
  rows=new Map<string,any>();get<T>(ns:string,id:string):T|undefined{return structuredClone(this.rows.get(`${ns}:${id}`));}
  list<T>(ns:string):T[]{return [...this.rows].filter(([key])=>key.startsWith(`${ns}:`)).map(([,v])=>structuredClone(v));}
  put<T extends {id:string}>(ns:string,value:T):T{this.rows.set(`${ns}:${value.id}`,structuredClone(value));return value;}
  delete(ns:string,id:string):boolean{return this.rows.delete(`${ns}:${id}`);}
  transaction<T>(fn:()=>T):T{return fn();}
}
async function http(handler:(path:string,body:Buffer,headers:Record<string,any>)=>{status?:number;body?:any;bytes?:Buffer;contentType?:string}|Promise<{status?:number;body?:any;bytes?:Buffer;contentType?:string}>) {
  const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const result=await handler(req.url??'/',Buffer.concat(chunks),req.headers);res.writeHead(result.status??200,{'content-type':result.contentType??'application/json'});res.end(result.bytes??JSON.stringify(result.body??{}));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as {port:number};
  return {url:`http://127.0.0.1:${address.port}`,close:()=>new Promise<void>(resolve=>server.close(()=>resolve()))};
}
function service(inbound:(...args:any[])=>Promise<any>=async()=>{},approve=false,now=()=>Date.now()) {
  const store=new MemoryStore();return {store,api:new IntegrationService(store,{encryptionKey:randomBytes(32),inbound,authorizeSend:async()=>approve,now})};
}
function signed(raw:Buffer,secret:string,slack=false,time=Date.now()):Record<string,string> {
  const timestamp=String(Math.floor(time/1000));const base=Buffer.concat([Buffer.from(slack?`v0:${timestamp}:`:`${timestamp}.`),raw]);
  return slack?{'x-slack-request-timestamp':timestamp,'x-slack-signature':'v0='+createHmac('sha256',secret).update(base).digest('hex')}:{'x-dots-timestamp':timestamp,'x-dots-signature':'sha256='+createHmac('sha256',secret).update(base).digest('hex')};
}

test('encrypts nested credentials and preserves redacted patches; configuration alone is not connected',async()=>{
  const {api,store}=service();const connector=api.create({kind:'mcp',name:'tools',config:{url:'http://127.0.0.1:99/mcp',headers:{Authorization:'Bearer private-value'}},scopes:['tools:read']});
  assert.equal(connector.state,'configured');assert.equal(connector.config.headers,'[redacted]');assert(!JSON.stringify([...store.rows]).includes('private-value'));
  assert.equal(api.update(connector.id,{config:{headers:'[redacted]'}}).config.headers,'[redacted]');
  const empty=api.create({kind:'slack',name:'empty',config:{}});assert.equal((await api.test(empty.id)).state,'needs_configuration');
  assert.throws(()=>api.create({kind:'mcp',name:'bad',config:{url:'http://untrusted.example/mcp'}}),/HTTPS/);
});
test('Slack authenticates actual requests, scopes send/read, and records only provider-verified state',async()=>{
  const requests:any[]=[];const server=await http((path,body,headers)=>{requests.push({path,body:JSON.parse(body.toString()),headers});return {body:path==='/auth.test'?{ok:true,user_id:'bot'}:path==='/conversations.history'?{ok:true,messages:[{text:'from-provider'}]}:{ok:true,ts:'actual-id'}};});
  try{
    const {api}=service(undefined,true);const c=api.create({kind:'slack',name:'Slack',config:{apiUrl:`${server.url}/`,botToken:'local-test-token',signingSecret:'secret'},scopes:['history:read','chat:write']});
    assert.equal((await api.test(c.id)).state,'connected');const data:any=await api.call(c.id,'read_messages',{channel:'D123'});assert.equal(data.messages[0].text,'from-provider');
    await api.call(c.id,'send_message',{channel:'D123',text:'controlled-server-only'});assert.equal(requests[2].headers.authorization,'Bearer local-test-token');
    api.update(c.id,{scopes:['history:read']});await assert.rejects(api.call(c.id,'send_message',{channel:'D123',text:'no'}),/scope/);assert.equal(requests.length,3);
    const denied=service();const d=denied.api.create({kind:'slack',name:'deny',config:{apiUrl:`${server.url}/`,botToken:'local',signingSecret:'secret'},scopes:['chat:write']});
    await assert.rejects(denied.api.call(d.id,'send_message',{channel:'D123',text:'no'}),/approval/);assert.equal(requests.length,3);
  }finally{await server.close();}
});
test('Provider rejection never produces connected state and connection proof does not widen local tool scopes',async()=>{
  let calls=0,valid=false;const server=await http(()=>{calls++;return {body:valid?{ok:true,user_id:'provider-bot'}:{ok:false,error:'missing_scope'}};});
  try{const {api}=service(undefined,true);const c=api.create({kind:'slack',name:'Scope check',config:{apiUrl:`${server.url}/`,botToken:'controlled',signingSecret:'secret'},scopes:['history:read']});const failed=await api.test(c.id);assert.equal(failed.state,'error');assert.equal(failed.lastError,'Slack: missing_scope');valid=true;assert.equal((await api.test(c.id)).state,'connected');assert.deepEqual((await api.tools(c.id)).map(t=>t.name),['read_messages']);await assert.rejects(api.call(c.id,'send_message',{channel:'D1',text:'blocked'}),/scope/);assert.equal(calls,2);await assert.rejects(api.call(c.id,'send_message',{channel:'D1',text:'blocked'},{readOnly:true}),/scope/);}finally{await server.close();}
});
test('Slack verifies raw bytes and timestamp, receives mentions/DM, and deduplicates provider retries',async()=>{
  const deliveries:any[]=[];const now=Date.now();const {api}=service(async(...args)=>{deliveries.push(args);},false,()=>now);
  const c=api.create({kind:'slack',name:'Slack',config:{dotId:'dot',signingSecret:'secret',botToken:'local',teamId:'T1'},scopes:['events:read']});
  const raw=Buffer.from(JSON.stringify({type:'event_callback',team_id:'T1',event_id:'E1',event:{type:'message',channel_type:'im',channel:'D1',text:'hello'}}));
  await Promise.all([api.webhook(c.id,signed(raw,'secret',true,now),raw),api.webhook(c.id,signed(raw,'secret',true,now),raw)]);await api.webhook(c.id,signed(raw,'secret',true,now),raw);assert.equal(deliveries.length,1);assert.equal(deliveries[0][2],'slack:D1');
  await assert.rejects(api.webhook(c.id,signed(raw,'secret',true,now-301_000),raw),/expired/);
  await assert.rejects(api.webhook(c.id,signed(raw,'wrong',true,now),raw),/signature/);
  await assert.rejects(api.webhook(c.id,signed(raw,'secret',true,now),Buffer.concat([raw,Buffer.from(' ')])),/signature/);
  const challenge=Buffer.from('{"type":"url_verification","challenge":"verify"}');assert.deepEqual((await api.webhook(c.id,signed(challenge,'secret',true,now),challenge)).body,{challenge:'verify'});
});
test('Generic webhook validates HMAC and retries failed delivery without losing event',async()=>{
  let count=0;const {api}=service(async()=>{if(++count===1)throw new Error('queue unavailable');});
  const c=api.create({kind:'webhook',name:'hook',config:{signingSecret:'secret',dotId:'dot'},scopes:['webhook:receive']});
  const raw=Buffer.from('{"text":"hello","requestId":"request-1"}');await assert.rejects(api.webhook(c.id,signed(raw,'secret'),raw),/queue/);
  await api.webhook(c.id,signed(raw,'secret'),raw);await api.webhook(c.id,signed(raw,'secret'),raw);assert.equal(count,2);
  const malformed=Buffer.from('not JSON');await assert.rejects(api.webhook(c.id,signed(malformed,'secret'),malformed),/JSON/);
});
test('Teams validates signed Bot Framework JWT issuer, audience, expiry, service URL and endorsed channel',async()=>{
  const pair=await generateKeyPair('RS256',{extractable:true});const jwk=await exportJWK(pair.publicKey);jwk.kid='local-key';
  const received:any[]=[];let tokenCalls=0;let posts=0;
  let url='';const server=await http((path)=>{
    if(path==='/openid')return {body:{issuer:'https://api.botframework.com',jwks_uri:`${url}/keys`}};
    if(path==='/keys')return {body:{keys:[{...jwk,endorsements:['msteams']}]}};
    if(path==='/token'){tokenCalls++;return {body:{access_token:'controlled-token',expires_in:3600}};}
    posts++;return {body:{id:'sent-id'}};
  });url=server.url;
  try{
    const {api}=service(async(...args)=>{received.push(args);},true);const c=api.create({kind:'teams',name:'Teams',config:{appId:'app',appSecret:'secret',openIdUrl:`${url}/openid`,tokenUrl:`${url}/token`,serviceUrl:url,dotId:'dot'},scopes:['messages:read','messages:send']});
    const body={type:'message',id:'activity',text:'hello',channelId:'msteams',serviceUrl:url,conversation:{id:'room'}};const raw=Buffer.from(JSON.stringify(body));
    const token=async(changes:Record<string,any>={})=>new SignJWT({serviceUrl:url,...changes}).setProtectedHeader({alg:'RS256',kid:'local-key'}).setIssuer('https://api.botframework.com').setAudience('app').setNotBefore('0s').setExpirationTime('5m').sign(pair.privateKey);
    await api.webhook(c.id,{authorization:`Bearer ${await token()}`},raw);assert.equal(received.length,1);
    await assert.rejects(api.webhook(c.id,{authorization:`Bearer ${await token({serviceUrl:'https://wrong.example'})}`},raw),/token/);
    const expired=await new SignJWT({serviceUrl:url,nbf:1,exp:2}).setProtectedHeader({alg:'RS256',kid:'local-key'}).setIssuer('https://api.botframework.com').setAudience('app').sign(pair.privateKey);
    await assert.rejects(api.webhook(c.id,{authorization:`Bearer ${expired}`},raw),/token/);
    const wrongAudience=await new SignJWT({serviceUrl:url}).setProtectedHeader({alg:'RS256',kid:'local-key'}).setIssuer('https://api.botframework.com').setAudience('attacker').setNotBefore('0s').setExpirationTime('5m').sign(pair.privateKey);
    await assert.rejects(api.webhook(c.id,{authorization:`Bearer ${wrongAudience}`},raw),/token/);
    await assert.rejects(api.webhook(c.id,{authorization:'Bearer malformed'},raw));
    assert.equal((await api.test(c.id)).state,'connected');await api.call(c.id,'send_message',{conversationId:'room',text:'local-server'});assert.equal(posts,1);assert.equal(tokenCalls,2);
    await assert.rejects(api.call(c.id,'send_message',{conversationId:'room',text:'blocked',serviceUrl:'https://other.example'}),/configured/);
  }finally{await server.close();}
});
test('GitHub tools use configured repository and authenticated provider HTTP responses',async()=>{
  const calls:any[]=[];const server=await http((path,body,headers)=>{calls.push({path,body:body.length?JSON.parse(body.toString()):null,headers});return {body:path.includes('?')?[{number:1,title:'actual issue'}]:{full_name:'owner/repo',number:2}};});
  try{const {api}=service(undefined,true);const c=api.create({kind:'github',name:'GitHub',config:{apiUrl:server.url,token:'token',owner:'owner',repo:'repo'},scopes:['repo:read','issues:write']});assert.equal((await api.test(c.id)).state,'connected');const issues:any=await api.call(c.id,'list_issues',{});assert.equal(issues[0].title,'actual issue');await api.call(c.id,'create_issue',{title:'controlled issue'});assert.equal(calls[2].body.title,'controlled issue');assert.equal(calls[2].headers.authorization,'Bearer token');}finally{await server.close();}
});
test('MCP discovery/call use official SDK against controlled Streamable HTTP server',async()=>{
  let writes=0;const server=createServer(async(req,res)=>{
    if(req.headers.authorization!=='Bearer local-mcp-token'){res.writeHead(401);res.end();return;}
    const mcp=new McpServer({name:'controlled',version:'1.0.0'});
    mcp.registerTool('read_value',{description:'Read controlled value',inputSchema:{key:z.string()},annotations:{readOnlyHint:true}},async({key})=>({content:[{type:'text',text:`value:${key}`}]}));
    mcp.registerTool('write_value',{description:'Writes controlled state',inputSchema:{value:z.string()},annotations:{readOnlyHint:false}},async()=>{writes++;return {content:[{type:'text',text:'stored'}]};});
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});await mcp.connect(transport);res.on('close',()=>{void transport.close();void mcp.close();});await transport.handleRequest(req,res);
  });await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as {port:number};
  try{const {api}=service();const c=api.create({kind:'mcp',name:'MCP',config:{url:`http://127.0.0.1:${address.port}/mcp`,headers:{Authorization:'Bearer local-mcp-token'},readOnlyTools:['read_value']},scopes:['tools:read','tools:call']});assert.equal((await api.test(c.id)).state,'connected');assert.deepEqual((await api.tools(c.id)).map(t=>t.name),['read_value','write_value']);assert.equal(await api.isReadOnlyTool(c.id,'read_value'),true);assert.equal(await api.isReadOnlyTool(c.id,'write_value'),false);const result:any=await api.call(c.id,'read_value',{key:'example'},{readOnly:true});assert.equal(result.content[0].text,'value:example');await assert.rejects(api.call(c.id,'write_value',{value:'not-approved'}),/approval/);await assert.rejects(api.call(c.id,'write_value',{value:'not-approved'},{readOnly:true}),/Read-only/);api.update(c.id,{config:{readOnlyTools:[]}});assert.equal(await api.isReadOnlyTool(c.id,'read_value'),false);await assert.rejects(api.call(c.id,'read_value',{key:'untrusted-hint'}),/approval/);assert.equal(writes,0);}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('Voice posts actual file bytes and returns actual provider audio; failures remain failures',async()=>{
  const requests:any[]=[];const audio=Buffer.from([82,73,70,70,0,1,2]);const server=await http((path,body,headers)=>{requests.push({path,body,headers});return path.endsWith('transcriptions')?{body:{text:'provider transcript'}}:{bytes:audio,contentType:'audio/wav'};});
  try{const {api,store}=service();api.updateVoiceSettings({enabled:true,apiUrl:server.url,apiKey:'private-audio-key',format:'wav'});assert.equal(api.getVoiceSettings().apiKey,'[redacted]');assert(!JSON.stringify([...store.rows]).includes('private-audio-key'));const bytes=Buffer.from('controlled-wave-bytes');assert.deepEqual(await api.transcribe(bytes,'input.wav','audio/wav'),{text:'provider transcript'});assert(requests[0].body.includes(bytes));assert(requests[0].headers['content-type'].startsWith('multipart/form-data; boundary='));assert.deepEqual((await api.speak('hello')).audio,audio);assert.equal(JSON.parse(requests[1].body.toString()).response_format,'wav');api.updateVoiceSettings({apiKey:'[redacted]'});await api.speak('hello');assert.equal(requests[2].headers.authorization,'Bearer private-audio-key');}finally{await server.close();}
  const failed=await http(()=>({status:401,body:{error:'denied'}}));try{const {api}=service();api.updateVoiceSettings({enabled:true,apiUrl:failed.url,apiKey:'bad'});await assert.rejects(api.transcribe(Buffer.from('x')),/401/);await assert.rejects(api.speak('hello'),/401/);}finally{await failed.close();}
});
test('Slack inbound replies are bound to verified thread, encrypted, approved per grant and idempotent across restart',async()=>{
  const posts:any[]=[],contexts:any[]=[],store=new MemoryStore(),key=randomBytes(32);let approvals=0,approved=false,task=0;
  const server=await http((path,body)=>{assert.equal(path,'/chat.postMessage');posts.push(JSON.parse(body.toString()));return {body:{ok:true,ts:`sent-${posts.length}`}};});
  const options={encryptionKey:key,inbound:async(...args:any[])=>{contexts.push(args[4]);return {task:{id:`slack-reply-task-${++task}`}};},authorizeSend:async()=>{approvals++;return approved;}};
  const api=new IntegrationService(store,options);
  try{
    const c=api.create({kind:'slack',name:'Slack',config:{dotId:'dot',apiUrl:`${server.url}/`,botToken:'private-token',signingSecret:'secret',autoReply:true},scopes:['events:read','chat:write']});
    const raw=Buffer.from(JSON.stringify({event_id:'E-reply-1',event:{type:'app_mention',channel:'C1',ts:'123.45',thread_ts:'120.12',text:'private question'}}));await api.webhook(c.id,signed(raw,'secret',true),raw);
    assert.deepEqual(contexts[0],{connectorId:c.id,replyTarget:{kind:'slack',channel:'C1',threadTs:'120.12'}});
    const results=await Promise.all([api.enqueueReply('slack-reply-task-1','private reply'),api.enqueueReply('slack-reply-task-1','different duplicate')]);assert.equal(results[0]?.status,'sent');assert.equal(posts.length,1);assert.equal(posts[0].thread_ts,'120.12');assert.equal(posts[0].text,'private reply');assert.equal(approvals,0);
    assert(!JSON.stringify([...store.rows]).includes('private reply'));assert(!JSON.stringify([...store.rows]).includes('120.12'));
    const restarted=new IntegrationService(store,options);assert.equal((await restarted.enqueueReply('slack-reply-task-1','duplicate'))?.status,'sent');assert.equal(posts.length,1);
    api.update(c.id,{config:{autoReply:false}});const raw2=Buffer.from(JSON.stringify({event_id:'E-reply-2',event:{type:'message',channel_type:'im',channel:'D1',ts:'200.1',text:'second'}}));await api.webhook(c.id,signed(raw2,'secret',true),raw2);
    const waiting=await api.enqueueReply('slack-reply-task-2','needs explicit approval');assert.equal(waiting?.status,'approval_required');assert.equal(posts.length,1);
    const denied=await api.deliverReply(waiting!.id);assert.equal(denied.status,'approval_required');assert.equal(posts.length,1);approved=true;const sent=await api.deliverReply(waiting!.id);assert.equal(sent.status,'sent');assert.equal(posts.length,2);await api.retryReply(waiting!.id);assert.equal(posts.length,2);assert.equal(approvals,2);
    api.update(c.id,{scopes:['events:read'],config:{autoReply:true}});const raw3=Buffer.from(JSON.stringify({event_id:'E-reply-3',event:{type:'app_mention',channel:'C1',text:'third'}}));await api.webhook(c.id,signed(raw3,'secret',true),raw3);const scopeBlocked=await api.enqueueReply('slack-reply-task-3','no send scope');assert.equal((await api.deliverReply(scopeBlocked!.id)).status,'approval_required');assert.equal(posts.length,2);
  }finally{await api.stop();await server.close();}
});
test('Reply failures and interrupted delivery remain visible and need explicit retry; polling never blindly duplicates them',async()=>{
  let calls=0,fail=true;const server=await http(()=>{calls++;return fail?{status:502,body:{error:'controlled'}}:{body:{ok:true,ts:'sent'}};});
  const store=new MemoryStore(),key=randomBytes(32),api=new IntegrationService(store,{encryptionKey:key,inbound:async()=>({task:{id:'failure-task'}})});
  try{const c=api.create({kind:'slack',name:'Slack',config:{dotId:'dot',apiUrl:`${server.url}/`,botToken:'token',signingSecret:'secret',autoReply:true},scopes:['events:read','chat:write']});const raw=Buffer.from(JSON.stringify({event_id:'reply-error',event:{type:'message',channel_type:'im',channel:'D1',text:'question'}}));await api.webhook(c.id,signed(raw,'secret',true),raw);const outbox=await api.enqueueReply('failure-task','answer');assert.equal(outbox?.status,'failed');assert.equal(outbox?.attempts,1);api.start({emailPollMs:20,outboxRetryMs:10});await new Promise(resolve=>setTimeout(resolve,40));await api.stop();assert.equal(calls,1);fail=false;assert.equal((await api.retryReply(outbox!.id)).status,'sent');assert.equal(calls,2);const row=store.get<any>('integration_outbox',outbox!.id);store.put('integration_outbox',{...row,status:'sending'});const restarted=new IntegrationService(store,{encryptionKey:key,inbound:async()=>{}});restarted.start({emailPollMs:20,outboxRetryMs:10});await new Promise(resolve=>setTimeout(resolve,30));assert.equal(restarted.listOutbox()[0].status,'delivery_unknown');assert.equal(calls,2);await restarted.stop();}finally{await api.stop();await server.close();}
});
test('Teams reply uses only the JWT-verified service URL binding and original conversation',async()=>{
  const pair=await generateKeyPair('RS256',{extractable:true}),key=await exportJWK(pair.publicKey);key.kid='reply-key';let url='',posted:any;
  const server=await http((path,body)=>path==='/openid'?{body:{issuer:'https://api.botframework.com',jwks_uri:`${url}/keys`}}:path==='/keys'?{body:{keys:[{...key,endorsements:['msteams']}]}}:path==='/token'?{body:{access_token:'local-token'}}:(posted={path,body:JSON.parse(body.toString())},{body:{id:'reply'}}));url=server.url;
  const {api}=service(async()=>({task:{id:'teams-reply-task'}}),true);
  try{const c=api.create({kind:'teams',name:'Teams',config:{dotId:'dot',appId:'app',appSecret:'secret',openIdUrl:`${url}/openid`,tokenUrl:`${url}/token`,autoReply:true},scopes:['messages:read','messages:send']});const raw=Buffer.from(JSON.stringify({type:'message',id:'incoming',text:'hello',channelId:'msteams',serviceUrl:url,conversation:{id:'original-room'}}));const token=await new SignJWT({serviceUrl:url}).setProtectedHeader({alg:'RS256',kid:key.kid}).setIssuer('https://api.botframework.com').setAudience('app').setNotBefore('0s').setExpirationTime('5m').sign(pair.privateKey);await api.webhook(c.id,{authorization:`Bearer ${token}`},raw);assert.equal((await api.enqueueReply('teams-reply-task','same conversation'))?.status,'sent');assert.equal(posted.path,'/v3/conversations/original-room/activities');assert.equal(posted.body.text,'same conversation');await assert.rejects(api.call(c.id,'send_message',{conversationId:'other-room',serviceUrl:url,text:'not bound'}),/configured/);}finally{await api.stop();await server.close();}
});
test('Generic webhook replies use signed outbound bytes and correlation; periodic pending dispatcher does not duplicate completion',async()=>{
  let posts=0,payload:any;const server=await http((_path,body,headers)=>{
    const timestamp=headers['x-dots-timestamp'];assert.equal(headers['x-dots-signature'],'sha256='+createHmac('sha256','secret').update(Buffer.concat([Buffer.from(`${timestamp}.`),body])).digest('hex'));
    posts++;payload=JSON.parse(body.toString());return {body:{accepted:true}};
  });const {api}=service(async()=>({task:{id:'hook-task'}}));
  try{const c=api.create({kind:'webhook',name:'Webhook',config:{dotId:'dot',signingSecret:'secret',url:`${server.url}/reply`,autoReply:true},scopes:['webhook:receive','webhook:send']});const raw=Buffer.from('{"text":"question","requestId":"correlation-id"}');await api.webhook(c.id,signed(raw,'secret'),raw);const outbox=await api.enqueueReply('hook-task','hook answer');assert.equal(outbox?.status,'sent');assert.deepEqual(payload,{text:'hook answer',inReplyTo:'correlation-id',requestId:'reply:correlation-id'});api.start({emailPollMs:20,outboxRetryMs:10});await new Promise(resolve=>setTimeout(resolve,30));assert.equal(posts,1);}finally{await api.stop();await server.close();}
});
