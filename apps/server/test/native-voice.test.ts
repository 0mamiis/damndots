import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import { SqliteStore } from '../src/storage.js';
import { OrbitRuntime } from '../src/runtime/index.js';
import { NativeVoiceService, OpenAICompatibleRealtimeProvider, registerNativeVoice } from '../src/native-voice.js';

// Controlled protocol peer; this SDP fixture is not a claim of tested Internet WebRTC media.
const offer='v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=sendrecv\r\n';
const answer='v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=sendrecv\r\n';
async function until(check:()=>boolean):Promise<void>{const deadline=Date.now()+3000;while(!check()){if(Date.now()>deadline)throw new Error('Voice state timed out');await new Promise(resolve=>setTimeout(resolve,3));}}
async function providerHarness(options:{rejectConfiguration?:boolean;failHangup?:boolean;rejectSdp?:boolean}={}) {
  const requests:Array<{path:string;body:string;authorization:string|undefined}>=[];const frames:any[]=[];const sockets:WebSocket[]=[];let serial=0;
  const http=createServer(async(req,res)=>{
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks).toString();requests.push({path:req.url??'',body,authorization:req.headers.authorization});
    if(req.url==='/v1/realtime/calls') {
      res.writeHead(201,{Location:`/v1/realtime/calls/rtc_test${++serial}`,'Content-Type':'application/sdp'});res.end(options.rejectSdp?'not SDP':answer);
    } else if(req.url?.endsWith('/hangup')) {res.writeHead(options.failHangup?503:200);res.end();}else{res.writeHead(404);res.end();}
  });
  const ws=new WebSocketServer({noServer:true});http.on('upgrade',(req,socket,head)=>{requests.push({path:req.url??'',body:'upgrade',authorization:req.headers.authorization});ws.handleUpgrade(req,socket,head,s=>ws.emit('connection',s,req));});
  ws.on('connection',socket=>{sockets.push(socket);socket.on('message',bytes=>{
    const frame=JSON.parse(String(bytes));frames.push(frame);
    if(frame.type==='session.update') socket.send(JSON.stringify(options.rejectConfiguration?{type:'error',error:{message:'Unsupported model'}}:{type:'session.updated',session:{id:'session-test',...frame.session}}));
  });});
  http.listen(0,'127.0.0.1');await once(http,'listening');const apiUrl=`http://127.0.0.1:${(http.address() as any).port}/v1`;
  return {apiUrl,requests,frames,sockets,send(event:any){sockets.at(-1)!.send(JSON.stringify(event));},async close(){for(const socket of ws.clients)socket.terminate();await new Promise<void>(resolve=>ws.close(()=>resolve()));await new Promise<void>(resolve=>http.close(()=>resolve()));}};
}
function runtimeFixture() {
  const store=new SqliteStore(':memory:');const runtime=new OrbitRuntime(store,{async run(input,hooks,signal){signal.throwIfAborted();hooks.onThread(`task-thread-${input.task.id}`);return {text:'Actual runtime result',threadId:`task-thread-${input.task.id}`,turnId:'actual-turn'};}});const dot=runtime.createDot({name:'Voice Dot',instructions:'Use Turkish when the user speaks Turkish.'});runtime.start();return {store,runtime,dot};
}
test('exact native dot call routes negotiate actual provider response, authenticate and perform genuine attach/hangup',async()=>{
  const upstream=await providerHarness();const {runtime,store,dot}=runtimeFixture();const app=Fastify();
  const provider=new OpenAICompatibleRealtimeProvider({configuration:()=>({apiUrl:upstream.apiUrl,apiKey:'server-secret',model:'audio-model',voice:'coral',enabled:true})});
  registerNativeVoice(app,{runtime,provider,authenticate:async(req,reply)=>{if(req.headers.authorization!=='Bearer native-test')return reply.code(401).send({detail:'unauthorized'});}});await app.ready();
  const headers={authorization:'Bearer native-test'};
  try {
    assert.equal((await app.inject({method:'POST',url:`/tbo/${dot.id}/voice/calls`,payload:{sdp:offer}})).statusCode,401);
    const created=await app.inject({method:'POST',url:`/tbo/${dot.id}/voice/calls`,headers,payload:{sdp:offer,debug_prompt_overrides:{}}});assert.equal(created.statusCode,201);assert.equal(created.body,answer);assert.equal(created.headers['content-type'],'application/sdp');assert.match(String(created.headers.location),/\/rtc_test1$/);assert.equal(created.body.includes('server-secret'),false);
    const post=upstream.requests.find(r=>r.path==='/v1/realtime/calls')!;assert.equal(post.authorization,'Bearer server-secret');assert.match(post.body,/name="sdp"/);assert.match(post.body,/name="session"/);assert.match(post.body,/"model":"audio-model"/);assert.match(post.body,/dot_submit_task/);
    const location=String(created.headers.location);
    const attached=await app.inject({method:'POST',url:location+'/attach',headers});assert.equal(attached.statusCode,200);assert.deepEqual(attached.json(),{});assert.ok(upstream.requests.some(r=>r.path==='/v1/realtime?call_id=rtc_test1'));
    assert.equal(upstream.frames[0].type,'session.update');assert.equal(upstream.frames[0].session.audio.input.format,undefined,'WebRTC negotiates its own media format');
    const other=runtime.createDot({name:'Other'});assert.equal((await app.inject({method:'POST',url:`/tbo/${other.id}/voice/calls/rtc_test1/stop`,headers})).statusCode,404);
    const stopped=await app.inject({method:'POST',url:location+'/stop',headers});assert.equal(stopped.statusCode,200);assert.ok(upstream.requests.some(r=>r.path==='/v1/realtime/calls/rtc_test1/hangup'));
    assert.equal(store.get<any>('native_voice_calls','rtc_test1').status,'stopped');assert.equal((await app.inject({method:'POST',url:location+'/stop',headers})).statusCode,200);
  } finally {await app.close();await runtime.stop();store.close();await upstream.close();}
});
test('voice transcripts stream in native schema and function calls execute the durable runtime once',async()=>{
  const upstream=await providerHarness();const {runtime,store,dot}=runtimeFixture();const notifications:Array<{method:string;params:any}>=[];const transcripts:any[]=[];
  const provider=new OpenAICompatibleRealtimeProvider({configuration:()=>({apiUrl:upstream.apiUrl,apiKey:'secret',model:'configured-model',voice:'coral',enabled:true})});const voice=new NativeVoiceService({runtime,provider,onTranscript:(...args)=>transcripts.push(args)});
  try {
    const {call}=await voice.create(dot.id,offer,dot.id);await voice.handleRpc('thread/realtime/start',{threadId:dot.id,transport:{type:'existingCall',callId:call.id},outputModality:'audio'},(method,params)=>notifications.push({method,params}));
    assert.deepEqual(notifications.find(n=>n.method==='thread/realtime/started')!.params,{threadId:dot.id,realtimeSessionId:call.id,version:'v1'});
    upstream.send({type:'conversation.item.input_audio_transcription.delta',item_id:'input-1',delta:'Bir rapor'});upstream.send({type:'conversation.item.input_audio_transcription.completed',item_id:'input-1',transcript:'Bir rapor hazırla'});
    upstream.send({type:'response.function_call_arguments.done',call_id:'tool-1',name:'dot_submit_task',arguments:'{"input":"Bir rapor hazırla"}'});
    upstream.send({type:'response.output_item.done',item:{type:'function_call',call_id:'tool-1',name:'dot_submit_task',arguments:'{"input":"Bir rapor hazırla"}'}});
    await until(()=>upstream.frames.some(f=>f.item?.type==='function_call_output'));
    const toolOutput=JSON.parse(upstream.frames.find(f=>f.item?.type==='function_call_output').item.output);assert.equal(toolOutput.status,'completed');assert.equal(toolOutput.result,'Actual runtime result');assert.equal(runtime.listTasks().length,1);assert.equal(runtime.listMessages(dot.id).find(m=>m.role==='user')!.channel,'voice');
    assert.equal(transcripts.length,1);assert.equal(transcripts[0][1],'user');assert.equal(transcripts[0][2],'Bir rapor hazırla');assert.ok(notifications.some(n=>n.method==='thread/realtime/transcript/delta'&&n.params.delta==='Bir rapor'));
    assert.ok(upstream.frames.some(f=>f.type==='response.create'));await voice.stop(dot.id,call.id);
  } finally {await voice.close();await runtime.stop();store.close();await upstream.close();}
});
test('thread realtime websocket RPC forwards real PCM bytes and emits schema-correct output audio',async()=>{
  const upstream=await providerHarness();const {runtime,store,dot}=runtimeFixture();const notifications:any[]=[];const voice=new NativeVoiceService({runtime,provider:new OpenAICompatibleRealtimeProvider({configuration:()=>({apiUrl:upstream.apiUrl,apiKey:'secret',model:'audio-model',voice:'coral',enabled:true})})});const notify=(method:string,params:any)=>notifications.push({method,params});
  try {
    assert.equal(await voice.handleRpc('thread/read',{threadId:dot.id},notify),undefined);
    await voice.handleRpc('thread/realtime/start',{threadId:dot.id,transport:{type:'websocket'},outputModality:'audio'},notify);
    const pcm=Buffer.alloc(480);for(let i=0;i<240;i++)pcm.writeInt16LE(Math.round(Math.sin(i/8)*1000),i*2);
    await voice.handleRpc('thread/realtime/appendAudio',{threadId:dot.id,audio:{data:pcm.toString('base64'),sampleRate:24000,numChannels:1}},notify);await until(()=>upstream.frames.some(f=>f.type==='input_audio_buffer.append'));assert.deepEqual(Buffer.from(upstream.frames.find(f=>f.type==='input_audio_buffer.append').audio,'base64'),pcm);
    upstream.send({type:'response.output_audio.delta',item_id:'output-1',delta:pcm.toString('base64')});await until(()=>notifications.some(n=>n.method==='thread/realtime/outputAudio/delta'));
    const audio=notifications.find(n=>n.method==='thread/realtime/outputAudio/delta').params.audio;assert.equal(audio.sampleRate,24000);assert.equal(audio.samplesPerChannel,240);assert.deepEqual(Buffer.from(audio.data,'base64'),pcm);
    assert.equal(upstream.frames[0].session.audio.input.format.rate,24000);assert.equal(upstream.frames[0].session.audio.output.format.type,'audio/pcm');
    await assert.rejects(voice.handleRpc('thread/realtime/appendAudio',{threadId:dot.id,audio:{data:'AAAA',sampleRate:48000,numChannels:2}},notify),/mono PCM16/);
    await voice.handleRpc('thread/realtime/appendText',{threadId:dot.id,text:'Merhaba',role:'user'},notify);await until(()=>upstream.frames.some(f=>f.item?.content?.[0]?.text==='Merhaba'));
    await voice.handleRpc('thread/realtime/stop',{threadId:dot.id},notify);assert.ok(notifications.some(n=>n.method==='thread/realtime/closed'));assert.equal(upstream.requests.some(r=>r.path.endsWith('/hangup')),false,'Primary websocket close terminates its actual transport');
  } finally {await voice.close();await runtime.stop();store.close();await upstream.close();}
});
test('missing configuration and rejected readiness never produce an active call or fake SDP',async()=>{
  const {runtime,store,dot}=runtimeFixture();
  const missing=new NativeVoiceService({runtime,provider:new OpenAICompatibleRealtimeProvider({configuration:()=>({apiUrl:'https://example.invalid/v1',apiKey:'',model:'audio',voice:'coral',enabled:false})})});
  await assert.rejects(missing.create(dot.id,offer),/Configure an enabled/);assert.equal(store.list('native_voice_calls').length,0);
  const upstream=await providerHarness({rejectConfiguration:true});const voice=new NativeVoiceService({runtime,provider:new OpenAICompatibleRealtimeProvider({configuration:()=>({apiUrl:upstream.apiUrl,apiKey:'secret',model:'unsupported-model',voice:'coral',enabled:true})})});
  try {const {call}=await voice.create(dot.id,offer);await assert.rejects(voice.attach(dot.id,call.id),/rejected session configuration/);assert.equal(voice.get(dot.id,call.id).status,'failed');assert.ok(upstream.requests.some(r=>r.path.endsWith('/hangup')));} finally {await voice.close();await runtime.stop();store.close();await upstream.close();}
});
test('provider hangup failure is visible and restart recovery really closes stale calls',async()=>{
  const upstream=await providerHarness({failHangup:true});const {runtime,store,dot}=runtimeFixture();const config=()=>({apiUrl:upstream.apiUrl,apiKey:'secret',model:'model',voice:'coral',enabled:true});const voice=new NativeVoiceService({runtime,provider:new OpenAICompatibleRealtimeProvider({configuration:config})});
  try {const {call}=await voice.create(dot.id,offer);await voice.attach(dot.id,call.id);await assert.rejects(voice.stop(dot.id,call.id),/503/);assert.equal(voice.get(dot.id,call.id).status,'failed');assert.match(voice.get(dot.id,call.id).lastError!,/503/);} finally {await voice.close();await upstream.close();await runtime.stop();store.close();}
  const success=await providerHarness();const next=runtimeFixture();next.store.put('native_voice_calls',{id:'rtc_stale',dotId:next.dot.id,threadId:null,status:'active',createdAt:new Date().toISOString(),attachedAt:new Date().toISOString(),stoppedAt:null,lastError:null});const recovered=new NativeVoiceService({runtime:next.runtime,provider:new OpenAICompatibleRealtimeProvider({configuration:()=>({apiUrl:success.apiUrl,apiKey:'secret',model:'model',voice:'coral',enabled:true})})});
  try {await recovered.recover();assert.equal(recovered.get(next.dot.id,'rtc_stale').status,'stopped');assert.ok(success.requests.some(r=>r.path==='/v1/realtime/calls/rtc_stale/hangup'));} finally {await recovered.close();await next.runtime.stop();next.store.close();await success.close();}
});
test('invalid upstream SDP is rejected and its allocated call is actually cleaned up',async()=>{
  const upstream=await providerHarness({rejectSdp:true});const {runtime,store,dot}=runtimeFixture();const voice=new NativeVoiceService({runtime,provider:new OpenAICompatibleRealtimeProvider({configuration:()=>({apiUrl:upstream.apiUrl,apiKey:'secret',model:'model',voice:'coral',enabled:true})})});
  try {await assert.rejects(voice.create(dot.id,offer),/invalid WebRTC/);assert.equal(store.list('native_voice_calls').length,0);assert.ok(upstream.requests.some(r=>r.path.endsWith('/hangup')));} finally {await voice.close();await runtime.stop();store.close();await upstream.close();}
});
