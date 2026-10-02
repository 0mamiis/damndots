import test from 'node:test';
import assert from 'node:assert/strict';
import {PipelineRealtimeProvider,ModalRealtimeProvider,speakable} from '../src/voice-pipeline.js';
import {chatCompletionText,cleanTranscript} from '../src/integrations/index.js';
import type {VoicePeerEvents} from '../src/voice-peer.js';

const wait=(ms=20)=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(transcripts:string[]) {
  const played:Buffer[]=[],stops:string[]=[],closed:string[]=[];let events!:VoicePeerEvents;
  const host:any={offer:async(_id:string,_sdp:string,e:VoicePeerEvents)=>{events=e;return 'v=0\r\nanswer';},play:async(_id:string,audio:Buffer)=>{played.push(audio);},stopPlayback:async(id:string)=>{stops.push(id);},close:async(id:string)=>{closed.push(id);},shutdown:async()=>{}};
  const spoken:string[]=[];
  const provider=new PipelineRealtimeProvider({host,configuration:()=>({apiUrl:'http://127.0.0.1:1/v1',apiKey:'k',model:'m',voice:'v',enabled:true}),transcribe:async()=>transcripts.shift()??'',speak:async text=>{spoken.push(text);return {audio:Buffer.from(text),mimeType:'audio/mpeg'};}});
  return {provider,played,stops,closed,spoken,get events(){return events;}};
}

test('a spoken sentence becomes a Dot task and the Dot reply is spoken back through the same call',async()=>{
  const f=fixture(['Merhaba, saat kaç?']),seen:any[]=[];
  const {callId}=await f.provider.create('v=0\r\noffer',{},new AbortController().signal);
  assert.match(callId,/^rtc_pipe_[a-f0-9]{32}$/);assert.equal(f.provider.pipelineCall(callId),true);
  const connection=await f.provider.attach(callId,{},e=>seen.push(e),new AbortController().signal);
  f.events.onUtterance(Buffer.from('wav'));await wait();
  assert.equal(seen[0].type,'conversation.item.input_audio_transcription.completed');assert.equal(seen[0].transcript,'Merhaba, saat kaç?');
  const call=seen[1].item;assert.equal(call.name,'dot_submit_task');assert.deepEqual(JSON.parse(call.arguments),{input:'Merhaba, saat kaç?'});
  connection.send({type:'conversation.item.create',item:{type:'function_call_output',call_id:call.call_id,output:JSON.stringify({status:'completed',result:'**Saat** 14:30.'})}});
  connection.send({type:'response.create'});await wait();
  assert.deepEqual(f.spoken,['Saat 14:30.']);assert.equal(f.played.length,1);
  assert.ok(seen.some(e=>e.type==='response.output_audio_transcript.done'&&e.transcript==='Saat 14:30.'));
  await f.provider.hangup(callId);assert.deepEqual(f.closed,[callId]);
});
test('silence, hallucinated fragments and utterances before attach are handled without spurious tasks',async()=>{
  const f=fixture(['','.','Evet']),seen:any[]=[];
  const {callId}=await f.provider.create('v=0\r\noffer',{},new AbortController().signal);
  f.events.onUtterance(Buffer.from('early'));
  await f.provider.attach(callId,{},e=>seen.push(e),new AbortController().signal);await wait();
  f.events.onUtterance(Buffer.from('b'));f.events.onUtterance(Buffer.from('c'));await wait(60);
  assert.deepEqual(seen.filter(e=>e.type==='conversation.item.input_audio_transcription.completed').map(e=>e.transcript),['Evet']);
});
test('the user speaking interrupts the assistant voice',async()=>{
  const f=fixture([]);const {callId}=await f.provider.create('v=0\r\noffer',{},new AbortController().signal);
  f.events.onSpeechStart();await wait();assert.deepEqual(f.stops,[callId]);
});
test('live official speech is relayed once and its session closes with the Dot call',async()=>{
  let playCount=0,closeCount=0,suppliedCall='';
  const host:any={offer:async()=> 'v=0\r\nanswer',play:async()=>{playCount++;},close:async()=>{},shutdown:async()=>{}};
  const provider=new PipelineRealtimeProvider({host,configuration:()=>({apiUrl:'http://localhost',apiKey:'k',model:'m',voice:'v',enabled:true}),transcribe:async()=>'',speak:async(_text,_signal,callId)=>{suppliedCall=callId??'';return {audio:Buffer.alloc(0),mimeType:'audio/pcm',streamed:true};},closeSpeaker:async()=>{closeCount++;}});
  const {callId}=await provider.create('v=0\r\noffer',{},new AbortController().signal);const connection=await provider.attach(callId,{},()=>{},new AbortController().signal);
  connection.send({type:'conversation.item.create',item:{type:'function_call_output',output:JSON.stringify({result:'Merhaba'})}});connection.send({type:'response.create'});await wait();
  assert.equal(suppliedCall,callId);assert.equal(playCount,0);await provider.hangup(callId);assert.equal(closeCount,1);
});
test('speech text drops markup, code and long tails',()=>{
  assert.equal(speakable('# Başlık\n**Merhaba** [site](https://x.test) `kod`\n```js\nlet a=1\n```'),'Başlık Merhaba site kod');
  const long='Bir cümle. '.repeat(200);const cut=speakable(long,100);assert.ok(cut.length<=100&&cut.endsWith('.'));
});
test('chat completions are read from JSON and from the SSE form some gateways return',()=>{
  const body={choices:[{message:{content:' Merhaba '}}]};
  assert.equal(chatCompletionText(JSON.stringify(body)),'Merhaba');
  assert.equal(chatCompletionText(JSON.stringify(body)+'data: [DONE]\n\n'),'Merhaba');
  assert.equal(chatCompletionText('data: {"choices":[{"delta":{"content":"Sel"}}]}\n\ndata: {"choices":[{"delta":{"content":"am"}}]}\n\ndata: [DONE]\n'),'Selam');
  assert.equal(chatCompletionText('not json'),'');
});
test('the silence marker is dropped from transcripts even when real words precede it',()=>{
  assert.equal(cleanTranscript('Ses test test[silence]'),'Ses test test');
  assert.equal(cleanTranscript('[silence]'),'');assert.equal(cleanTranscript(' [Silence] .'),'.');assert.equal(cleanTranscript('Merhaba nasılsın'),'Merhaba nasılsın');
});
test('the configured mode chooses the provider and call ids route hangup/attach to their owner',async()=>{
  const f=fixture([]),calls:string[]=[];
  const realtime:any={configuration:()=>({}),create:async()=>{calls.push('realtime.create');return {callId:'rtc_real',answerSdp:'v=0'};},attach:async()=>{calls.push('realtime.attach');return {send(){},close(){}};},hangup:async()=>{calls.push('realtime.hangup');}};
  let mode:'realtime'|'pipeline'='realtime';const modal=new ModalRealtimeProvider(realtime,f.provider,()=>mode);
  assert.equal((await modal.create('v=0',{},new AbortController().signal)).callId,'rtc_real');
  mode='pipeline';const {callId}=await modal.create('v=0\r\noffer',{},new AbortController().signal);assert.equal(modal.pipelineCall(callId),true);assert.equal(modal.pipelineCall('rtc_real'),false);
  await modal.attach(callId,{},()=>{},new AbortController().signal);await modal.hangup('rtc_real',new AbortController().signal);await modal.hangup(callId,new AbortController().signal);
  assert.deepEqual(calls,['realtime.create','realtime.hangup']);assert.deepEqual(f.closed,[callId]);
});
