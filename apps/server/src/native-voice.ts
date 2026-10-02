import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Dot, RunResult, Task } from '@dots/contracts';
import type { OrbitRuntime } from './runtime/index.js';

export class NativeVoiceError extends Error {
  constructor(message:string,readonly statusCode=400) {super(message);}
}
export interface RealtimeConfiguration {apiUrl:string;apiKey:string;model:string;voice:string;enabled:boolean;}
export interface VoiceConnection {send(event:Record<string,unknown>):void;close():void;}
export interface RealtimeCallProvider {
  create(sdp:string,session:Record<string,unknown>,signal:AbortSignal):Promise<{callId:string;answerSdp:string}>;
  attach(callId:string,session:Record<string,unknown>,onEvent:(event:Record<string,any>)=>void,signal:AbortSignal):Promise<VoiceConnection>;
  connect?(session:Record<string,unknown>,onEvent:(event:Record<string,any>)=>void,signal:AbortSignal):Promise<VoiceConnection>;
  hangup(callId:string,signal:AbortSignal):Promise<void>;
  configuration():RealtimeConfiguration|Promise<RealtimeConfiguration>;
  /** True when the provider (not the transcript hook) already records the conversation, e.g. the STT/LLM/TTS pipeline. */
  pipelineCall?(callId:string):boolean;
}
export interface CompatibleRealtimeProviderOptions {
  configuration:()=>RealtimeConfiguration|Promise<RealtimeConfiguration>;
  fetch?:typeof fetch;
  websocket?:(url:string,options:{headers:Record<string,string>})=>WebSocket;
  timeoutMs?:number;
}
function validSdp(sdp:unknown):sdp is string {return typeof sdp==='string'&&sdp.length<=1024*1024&&/^v=0\r?\n/.test(sdp)&&/\r?\nm=audio\s/.test(sdp);}
function endpoint(value:string):URL {
  const url=new URL(value);
  if(url.username||url.password||url.hash||!['http:','https:'].includes(url.protocol)) throw new NativeVoiceError('Invalid audio provider URL');
  if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new NativeVoiceError('Remote audio providers require HTTPS');
  return url;
}
/** Native WebRTC media is negotiated with the provider, never synthesized by the gateway. */
export class OpenAICompatibleRealtimeProvider implements RealtimeCallProvider {
  constructor(readonly options:CompatibleRealtimeProviderOptions) {}
  async configuration():Promise<RealtimeConfiguration> {
    const config=await this.options.configuration();
    if(!config.enabled||!config.apiKey||!config.model||!config.voice) throw new NativeVoiceError('Configure an enabled Realtime audio provider and API key before calling your dot',409);
    endpoint(config.apiUrl);return config;
  }
  private async request(path:string,init:RequestInit,signal:AbortSignal):Promise<Response> {
    const config=await this.configuration();
    const response=await (this.options.fetch??fetch)(endpoint(`${config.apiUrl.replace(/\/$/,'')}${path}`),{...init,headers:{...init.headers,Authorization:`Bearer ${config.apiKey}`},redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(this.options.timeoutMs??20_000)])});
    if(!response.ok) {await response.body?.cancel();throw new NativeVoiceError(`Realtime audio provider rejected the request (${response.status})`,502);}
    return response;
  }
  async create(sdp:string,session:Record<string,unknown>,signal:AbortSignal):Promise<{callId:string;answerSdp:string}> {
    if(!validSdp(sdp)) throw new NativeVoiceError('A valid audio SDP offer is required');
    const form=new FormData();form.set('sdp',sdp);form.set('session',JSON.stringify(session));
    const response=await this.request('/realtime/calls',{method:'POST',body:form},signal);
    const location=response.headers.get('location');
    const callId=location?new URL(location,'http://provider.invalid').pathname.split('/').at(-1):undefined;
    const answerSdp=await response.text();
    if(!callId||!/^rtc_[A-Za-z0-9_-]+$/.test(callId)||!validSdp(answerSdp)) {
      if(callId&&/^rtc_[A-Za-z0-9_-]+$/.test(callId)) await this.hangup(callId,new AbortController().signal).catch(()=>{});
      throw new NativeVoiceError('Audio provider returned an invalid WebRTC call id or SDP answer',502);
    }
    return {callId,answerSdp};
  }
  async hangup(callId:string,signal:AbortSignal):Promise<void> {
    if(!/^rtc_[A-Za-z0-9_-]+$/.test(callId)) throw new NativeVoiceError('Invalid realtime call id');
    const response=await this.request(`/realtime/calls/${encodeURIComponent(callId)}/hangup`,{method:'POST'},signal);await response.body?.cancel();
  }
  async attach(callId:string,session:Record<string,unknown>,onEvent:(event:Record<string,any>)=>void,signal:AbortSignal):Promise<VoiceConnection> {
    return this.socket(session,onEvent,signal,callId);
  }
  async connect(session:Record<string,unknown>,onEvent:(event:Record<string,any>)=>void,signal:AbortSignal):Promise<VoiceConnection> {
    return this.socket(session,onEvent,signal);
  }
  private async socket(session:Record<string,unknown>,onEvent:(event:Record<string,any>)=>void,signal:AbortSignal,callId?:string):Promise<VoiceConnection> {
    signal.throwIfAborted();const config=await this.configuration();
    const url=endpoint(`${config.apiUrl.replace(/\/$/,'')}/realtime`);url.protocol=url.protocol==='https:'?'wss:':'ws:';url.searchParams.set(callId?'call_id':'model',callId??String(session.model??config.model));
    const socket=this.options.websocket?.(url.href,{headers:{Authorization:`Bearer ${config.apiKey}`}})??new WebSocket(url,{headers:{Authorization:`Bearer ${config.apiKey}`},maxPayload:16*1024*1024});
    let closed=false;let ready=false;
    const send=(event:Record<string,unknown>)=>{if(socket.readyState!==WebSocket.OPEN) throw new NativeVoiceError('Realtime audio connection is not open',409);socket.send(JSON.stringify(event));};
    const connection:VoiceConnection={send,close:()=>{closed=true;signal.removeEventListener('abort',abort);socket.close();}};
    const abort=()=>{closed=true;socket.terminate();};signal.addEventListener('abort',abort,{once:true});
    await new Promise<void>((resolveReady,rejectReady)=>{
      const timer=setTimeout(()=>{closed=true;socket.terminate();rejectReady(new NativeVoiceError('Realtime sideband readiness timed out',504));},this.options.timeoutMs??20_000);
      const reject=(error:Error)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);rejectReady(error);};
      socket.on('open',()=>{if(signal.aborted) {abort();reject(new NativeVoiceError('Voice startup was cancelled',409));return;}
        const audio=session.audio as Record<string,any>|undefined;
        const wireSession=callId?session:{...session,audio:{...audio,input:{...audio?.input,format:{type:'audio/pcm',rate:24000}},output:{...audio?.output,format:{type:'audio/pcm',rate:24000}}}};
        send({type:'session.update',event_id:`config_${randomUUID()}`,session:wireSession});});
      socket.on('message',bytes=>{
        let event:Record<string,any>;try {event=JSON.parse(String(bytes));} catch {reject(new NativeVoiceError('Realtime provider sent invalid JSON',502));socket.terminate();return;}
        if(event.type==='session.updated'&&!ready) {ready=true;clearTimeout(timer);resolveReady();}
        if(event.type==='error'&&!ready) {closed=true;reject(new NativeVoiceError('Realtime provider rejected session configuration',502));socket.terminate();return;}
        try {onEvent(event);} catch { /* private consumers cannot terminate provider audio */ }
      });
      socket.on('error',()=>{if(!ready) reject(new NativeVoiceError('Unable to establish realtime audio connection',502));else if(!closed) onEvent({type:'error',error:{message:'Realtime audio connection failed'}});});
      socket.on('close',()=>{signal.removeEventListener('abort',abort);if(!ready) reject(new NativeVoiceError('Realtime sideband closed before readiness',502));else if(!closed) onEvent({type:'transport.closed',reason:'Realtime audio connection closed'});});
    });
    if(signal.aborted) {connection.close();throw new NativeVoiceError('Voice startup was cancelled',409);}
    return connection;
  }
}

export interface VoiceCallRecord {
  id:string;dotId:string;threadId:string|null;status:'allocated'|'active'|'stopped'|'failed';
  createdAt:string;attachedAt:string|null;stoppedAt:string|null;lastError:string|null;
}
type Notify=(method:string,params:Record<string,unknown>)=>void;
interface LiveCall {record:VoiceCallRecord;controller:AbortController;connection?:VoiceConnection;notify?:Notify;toolCalls:Set<string>;attaching?:Promise<VoiceCallRecord>;}
export interface NativeVoiceOptions {
  runtime:OrbitRuntime;
  provider:RealtimeCallProvider;
  authenticate?:(request:FastifyRequest,reply:FastifyReply)=>unknown|Promise<unknown>;
  resolveDotId?:(tboOrThreadId:string)=>string;
  emit?:(type:string,data:Record<string,unknown>,dotId?:string|null,taskId?:string|null)=>void;
  onTranscript?:(dotId:string,role:'user'|'assistant',text:string,callId:string,itemId:string)=>void;
  taskTimeoutMs?:number;
  registerLifecycle?:boolean;
}
const voiceTools=[
  {type:'function',name:'dot_submit_task',description:'When the user asks for work, execute it through the dot task runtime. The runtime enforces its user approval policy; do not claim it is finished before the returned result confirms completion.',parameters:{type:'object',properties:{input:{type:'string'},title:{type:'string'}},required:['input'],additionalProperties:false}},
  {type:'function',name:'dot_read_tasks',description:'Read the actual status and results of this dot’s tasks.',parameters:{type:'object',properties:{},additionalProperties:false}},
  {type:'function',name:'dot_read_memory',description:'Read the actual persistent notes for this dot.',parameters:{type:'object',properties:{},additionalProperties:false}},
  {type:'function',name:'end_voice_call',description:'End this voice conversation only when the user explicitly asks to hang up or end it.',parameters:{type:'object',properties:{},additionalProperties:false}},
];

export class NativeVoiceService {
  private calls=new Map<string,LiveCall>();
  private threadCalls=new Map<string,string>();
  private creatingDots=new Set<string>();
  constructor(readonly options:NativeVoiceOptions) {}
  private resolveDot(key:string):Dot {
    if(this.options.resolveDotId) return this.options.runtime.getDot(this.options.resolveDotId(key));
    const dot=this.options.runtime.listDots().find(d=>d.id===key||d.rootThreadId===key||d.messagingRoomId===key);
    if(!dot) throw new NativeVoiceError('Dot not found',404);return dot;
  }
  private publish(type:string,call:VoiceCallRecord,data:Record<string,unknown>={}):void {
    this.options.emit?.(type,{call,...data},call.dotId,null);
    this.options.runtime.activity(call.dotId,null,type,type,{callId:call.id,...data});
  }
  private save(record:VoiceCallRecord):VoiceCallRecord {return this.options.runtime.store.put('native_voice_calls',record);}
  get(dotKey:string,callId:string):VoiceCallRecord {
    const dot=this.resolveDot(dotKey);const call=this.options.runtime.store.get<VoiceCallRecord>('native_voice_calls',callId);
    if(!call||call.dotId!==dot.id) throw new NativeVoiceError('Voice call not found',404);return call;
  }
  private async session(dot:Dot,modality='audio'):Promise<Record<string,unknown>> {
    const config=await this.options.provider.configuration();
    const memory=this.options.runtime.listMemories(dot.id).slice(-20).map(m=>`${m.title}: ${m.content.slice(0,2000)}`).join('\n');
    const history=this.options.runtime.listMessages(dot.id).slice(-10).map(m=>`${m.role}: ${m.text.slice(0,2000)}`).join('\n');
    return {type:'realtime',model:config.model,output_modalities:[modality==='text'?'text':'audio'],audio:{input:{transcription:{model:'gpt-4o-mini-transcribe'},turn_detection:{type:'server_vad'}},output:{voice:config.voice}},instructions:[`You are ${dot.name}, the user's dot. Speak naturally and concisely in the user's language. Use dot_submit_task for all work needing local tools, files, connected apps, computers or research. Voice chat alone cannot perform that work. User requests create durable tasks. Report real status and results, and never invent files or successful actions. Approval requests appear in the dashboard.`,dot.instructions,memory?`Persistent notes:\n${memory}`:'',history?`Recent conversation:\n${history}`:''].filter(Boolean).join('\n\n'),tools:voiceTools,tool_choice:'auto'};
  }
  async create(dotKey:string,sdp:string,threadId:string|null=null):Promise<{call:VoiceCallRecord;answerSdp:string}> {
    const dot=this.resolveDot(dotKey);
    if(this.creatingDots.has(dot.id)||[...this.calls.values()].some(c=>c.record.dotId===dot.id&&['allocated','active'].includes(c.record.status))) throw new NativeVoiceError('This dot already has an active voice call',409);
    this.creatingDots.add(dot.id);
    const controller=new AbortController();
    try {
    const result=await this.options.provider.create(sdp,await this.session(dot),controller.signal);
    const call=this.save({id:result.callId,dotId:dot.id,threadId,status:'allocated',createdAt:new Date().toISOString(),attachedAt:null,stoppedAt:null,lastError:null});
    this.calls.set(call.id,{record:call,controller,toolCalls:new Set()});if(threadId) this.threadCalls.set(threadId,call.id);
    this.publish('voice.call.allocated',call);return {call,answerSdp:result.answerSdp};
    } finally {this.creatingDots.delete(dot.id);}
  }
  async attach(dotKey:string,callId:string,notify?:Notify):Promise<VoiceCallRecord> {
    const record=this.get(dotKey,callId);const live=this.calls.get(callId);
    if(record.status==='active'&&live?.connection) {if(notify) {live.notify=notify;notify('thread/realtime/started',{threadId:record.threadId??dotKey,realtimeSessionId:record.id,version:'v1'});}return record;}
    if(!live||record.status!=='allocated') throw new NativeVoiceError('Voice call is no longer available',409);
    if(live.attaching) return live.attaching;
    if(notify) live.notify=notify;
    live.attaching=(async()=>{
      try {
        live.connection=await this.options.provider.attach(callId,await this.session(this.resolveDot(dotKey)),event=>this.observe(live,event),live.controller.signal);
        if(live.controller.signal.aborted) {live.connection.close();throw new NativeVoiceError('Voice startup was cancelled',409);}
        live.record=this.save({...record,status:'active',attachedAt:new Date().toISOString()});this.publish('voice.call.active',live.record);
        live.notify?.('thread/realtime/started',{threadId:record.threadId??dotKey,realtimeSessionId:record.id,version:'v1'});
        return live.record;
      } catch(error) {
        if(this.options.runtime.store.get<VoiceCallRecord>('native_voice_calls',record.id)?.status==='stopped') throw error;
        live.record=this.save({...record,status:'failed',lastError:error instanceof Error?error.message:'Voice startup failed',stoppedAt:new Date().toISOString()});this.publish('voice.call.failed',live.record);live.notify?.('thread/realtime/error',{threadId:record.threadId??dotKey,message:live.record.lastError});
        await this.options.provider.hangup(callId,new AbortController().signal).catch(()=>{});live.controller.abort();live.connection?.close();throw error;
      }
    })();
    return live.attaching;
  }
  async stop(dotKey:string,callId:string):Promise<VoiceCallRecord> {
    const record=this.get(dotKey,callId);
    if(record.status==='stopped') return record;
    const live=this.calls.get(callId);
    // A successful provider hangup is required before the call is marked stopped.
    try {if(!callId.startsWith('ws_')) await this.options.provider.hangup(callId,new AbortController().signal);} catch(error) {
      const failed=this.save({...record,status:'failed',lastError:error instanceof Error?error.message:'Provider hangup failed'});if(live) live.record=failed;this.publish('voice.call.failed',failed);throw error;
    }
    live?.controller.abort();live?.connection?.close();
    const stopped=this.save({...record,status:'stopped',stoppedAt:new Date().toISOString(),lastError:null});if(live) {live.record=stopped;live.notify?.('thread/realtime/closed',{threadId:record.threadId??dotKey,reason:'user_ended'});}if(record.threadId) this.threadCalls.delete(record.threadId);this.calls.delete(callId);this.publish('voice.call.stopped',stopped);return stopped;
  }
  /** Close stale provider calls after a server restart instead of reporting them as active. */
  async recover():Promise<void> {
    for(const call of this.options.runtime.store.list<VoiceCallRecord>('native_voice_calls').filter(c=>['allocated','active'].includes(c.status))) {
      try {await this.stop(call.dotId,call.id);} catch { /* failure is persisted and visible; never invent a successful hangup */ }
    }
  }
  async close():Promise<void> {await Promise.allSettled([...this.calls.values()].map(c=>this.stop(c.record.dotId,c.record.id)));for(const c of this.calls.values()) {c.controller.abort();c.connection?.close();}this.calls.clear();}
  private observe(live:LiveCall,event:Record<string,any>):void {
    if(live.controller.signal.aborted) return;
    const call=live.record;const threadId=call.threadId??this.options.runtime.getDot(call.dotId).rootThreadId??call.dotId;
    if(event.type==='transport.closed') {
      this.publish('voice.error',call,{message:event.reason??'Realtime sideband disconnected'});live.notify?.('thread/realtime/error',{threadId,message:event.reason??'Realtime sideband disconnected'});
      void this.stop(call.dotId,call.id).catch(()=>{});return;
    }
    if(event.type==='error') {this.publish('voice.error',call,{message:event.error?.message??'Audio provider error'});live.notify?.('thread/realtime/error',{threadId,message:event.error?.message??'Audio provider error'});return;}
    if(event.type==='session.closed') {live.record=this.save({...call,status:'stopped',stoppedAt:new Date().toISOString(),lastError:null});live.notify?.('thread/realtime/closed',{threadId,reason:event.reason??'provider_closed'});live.controller.abort();this.calls.delete(call.id);if(call.threadId) this.threadCalls.delete(call.threadId);this.publish('voice.call.stopped',live.record);return;}
    const user=String(event.type??'').startsWith('conversation.item.input_audio_transcription.');
    const assistant=/^response\.(?:output_audio_transcript|audio_transcript|output_text|text)\./.test(String(event.type??''));
    if(user||assistant) {
      const role=user?'user':'assistant';const final=/\.(?:completed|done)$/.test(event.type);const text=final?event.transcript??event.text:event.delta;
      if(typeof text==='string'&&text) {
        live.notify?.(final?'thread/realtime/transcript/done':'thread/realtime/transcript/delta',{threadId,role,...final?{text}:{delta:text}});
        if(final) {if(!this.options.provider.pipelineCall?.(call.id)) this.options.onTranscript?.(call.dotId,role,text,call.id,String(event.item_id??event.response_id??event.event_id??randomUUID()));this.publish('voice.transcript',call,{role,text});}
      }
    }
    if(event.type==='response.output_audio.delta'||event.type==='response.audio.delta') {
      if(typeof event.delta==='string') live.notify?.('thread/realtime/outputAudio/delta',{threadId,audio:{data:event.delta,numChannels:1,sampleRate:24000,samplesPerChannel:Buffer.from(event.delta,'base64').length/2,itemId:event.item_id??null}});
    }
    if(event.type==='response.function_call_arguments.done'||event.type==='response.output_item.done'&&event.item?.type==='function_call') {
      const item=event.item??event;const callId=item.call_id;if(!callId||live.toolCalls.has(callId)) return;live.toolCalls.add(callId);
      void this.tool(live,item).catch(error=>this.publish('voice.tool.failed',live.record,{message:error instanceof Error?error.message:'Voice tool failed'}));
    }
    live.notify?.('thread/realtime/itemAdded',{threadId,item:event});
  }
  private async tool(live:LiveCall,item:Record<string,any>):Promise<void> {
    let output:unknown;
    try {
      const args=typeof item.arguments==='string'?JSON.parse(item.arguments):item.arguments??{};
      switch(item.name) {
        case 'dot_read_tasks':output=this.options.runtime.listTasks({dotId:live.record.dotId});break;
        case 'dot_read_memory':output=this.options.runtime.listMemories(live.record.dotId);break;
        case 'dot_submit_task': {
          if(typeof args.input!=='string'||!args.input.trim()) throw new NativeVoiceError('Task input is required');
          const {task}=this.options.runtime.submitMessage(live.record.dotId,{text:args.input,channel:'voice',requestId:`${live.record.id}:${item.call_id}`});
          this.publish('voice.task.submitted',live.record,{taskId:task.id});output=await this.waitTask(task.id,live.controller.signal);break;
        }
        case 'end_voice_call':await this.stop(live.record.dotId,live.record.id);return;
        default:throw new NativeVoiceError('Unknown voice tool');
      }
    } catch(error) {output={error:error instanceof Error?error.message:'Voice tool failed'};}
    if(live.controller.signal.aborted) return;
    live.connection?.send({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify(output)}});
    live.connection?.send({type:'response.create'});
  }
  private waitTask(taskId:string,signal:AbortSignal):Promise<Pick<Task,'id'|'status'|'result'|'error'>> {
    return new Promise((resolveDone,rejectDone)=>{
      const snapshot=()=>{const task=this.options.runtime.getTask(taskId);if(['completed','failed','cancelled','interrupted'].includes(task.status)) {cleanup();resolveDone({id:task.id,status:task.status,result:task.result,error:task.error});}};
      const off=this.options.runtime.subscribe(event=>{if(event.taskId===taskId&&event.type==='task.updated') snapshot();});
      const abort=()=>{cleanup();rejectDone(new NativeVoiceError('Voice call ended while task continues',409));};
      const timer=setTimeout(()=>{cleanup();resolveDone({id:taskId,status:this.options.runtime.getTask(taskId).status,result:null,error:'Task remains active; inspect the dashboard for its eventual result'});},this.options.taskTimeoutMs??10*60_000);
      const cleanup=()=>{off();clearTimeout(timer);signal.removeEventListener('abort',abort);};signal.addEventListener('abort',abort,{once:true});if(signal.aborted) abort();else snapshot();
    });
  }
  /** Intercept these methods before forwarding ordinary RPC to Codex App Server. */
  async handleRpc(method:string,params:Record<string,any>,notify:Notify):Promise<unknown> {
    if(!method.startsWith('thread/realtime/')) return undefined;
    if(method==='thread/realtime/listVoices') {const config=await this.options.provider.configuration();return {voices:{defaultV1:config.voice,defaultV2:config.voice,v1:[config.voice],v2:[config.voice]}};}
    const threadId=String(params.threadId??'');const dot=this.resolveDot(threadId);
    if(method==='thread/realtime/start') {
      if(this.threadCalls.has(threadId)&&params.transport?.type!=='existingCall') throw new NativeVoiceError('This thread already has an active realtime session',409);
      if(params.transport?.type==='existingCall') {
        const live=this.calls.get(params.transport.callId);if(!live||live.record.dotId!==dot.id) throw new NativeVoiceError('Voice call does not belong to this thread',404);
        live.record=this.save({...live.record,threadId});this.threadCalls.set(threadId,live.record.id);await this.attach(dot.id,live.record.id,notify);return {};
      }
      if(params.transport?.type==='webrtc') {const result=await this.create(dot.id,params.transport.sdp,threadId);notify('thread/realtime/sdp',{threadId,sdp:result.answerSdp});await this.attach(dot.id,result.call.id,notify);return {};}
      if(!this.options.provider.connect) throw new NativeVoiceError('Configured provider does not support realtime WebSocket audio',409);
      const controller=new AbortController();const record:VoiceCallRecord={id:`ws_${randomUUID()}`,dotId:dot.id,threadId,status:'allocated',createdAt:new Date().toISOString(),attachedAt:null,stoppedAt:null,lastError:null};
      const live:LiveCall={record,controller,notify,toolCalls:new Set()};
      try {live.connection=await this.options.provider.connect(await this.session(dot,params.outputModality),event=>this.observe(live,event),controller.signal);live.record=this.save({...record,status:'active',attachedAt:new Date().toISOString()});this.calls.set(record.id,live);this.threadCalls.set(threadId,record.id);notify('thread/realtime/started',{threadId,realtimeSessionId:record.id,version:'v1'});this.publish('voice.call.active',live.record);return {};} catch(error) {controller.abort();live.connection?.close();throw error;}
    }
    const live=this.calls.get(this.threadCalls.get(threadId)??'');if(!live?.connection||live.record.status!=='active') throw new NativeVoiceError('Realtime session is not active',409);
    if(method==='thread/realtime/stop') {
      if(live.record.id.startsWith('ws_')) {live.controller.abort();live.connection.close();live.record=this.save({...live.record,status:'stopped',stoppedAt:new Date().toISOString()});this.calls.delete(live.record.id);this.threadCalls.delete(threadId);notify('thread/realtime/closed',{threadId,reason:'user_ended'});this.publish('voice.call.stopped',live.record);}else await this.stop(dot.id,live.record.id);return {};
    }
    if(method==='thread/realtime/appendAudio') {const audio=params.audio;if(!audio||audio.sampleRate!==24000||audio.numChannels!==1||typeof audio.data!=='string'||audio.data.length>20*1024*1024) throw new NativeVoiceError('Realtime audio requires mono PCM16 at 24 kHz');live.connection.send({type:'input_audio_buffer.append',audio:audio.data});return {};}
    if(method==='thread/realtime/appendText'||method==='thread/realtime/appendSpeech') {
      if(typeof params.text!=='string'||!params.text.trim()||params.text.length>200000) throw new NativeVoiceError('Realtime text is required');
      const role=method==='thread/realtime/appendSpeech'?'user':params.role??'user';if(!['user','assistant','developer'].includes(role)) throw new NativeVoiceError('Invalid transcript role');
      live.connection.send({type:'conversation.item.create',item:{type:'message',role,content:[{type:role==='assistant'?'output_text':'input_text',text:method==='thread/realtime/appendSpeech'?`Read this text aloud exactly: ${params.text}`:params.text}]}});
      if(role==='user') live.connection.send({type:'response.create'});return {};
    }
    throw new NativeVoiceError(`Unsupported realtime method: ${method}`,400);
  }
}

export function registerNativeVoice(app:FastifyInstance,options:NativeVoiceOptions):NativeVoiceService {
  const voice=new NativeVoiceService(options);const routeOptions=options.authenticate?{preHandler:options.authenticate as any}:{};
  app.post('/tbo/:tbo_id/voice/calls',routeOptions,async(request,reply)=>{
    const body=request.body as {sdp?:unknown};if(!validSdp(body?.sdp)) throw new NativeVoiceError('A valid audio SDP offer is required');
    const dotId=String((request.params as any).tbo_id);const result=await voice.create(dotId,body.sdp);
    return reply.code(201).header('Location',`/tbo/${encodeURIComponent(dotId)}/voice/calls/${result.call.id}`).header('Content-Type','application/sdp').send(result.answerSdp);
  });
  app.post('/tbo/:tbo_id/voice/calls/:call_id/attach',routeOptions,async(request)=>{await voice.attach(String((request.params as any).tbo_id),String((request.params as any).call_id));return {};});
  app.post('/tbo/:tbo_id/voice/calls/:call_id/stop',routeOptions,async(request)=>{await voice.stop(String((request.params as any).tbo_id),String((request.params as any).call_id));return {};});
  app.post('/wham/realtime/calls',routeOptions,async(request,reply)=>{
    const body=request.body as {sdp?:unknown};if(!validSdp(body?.sdp)) throw new NativeVoiceError('A valid audio SDP offer is required');
    const threadId=String(request.headers['thread-id']??'');if(!threadId) throw new NativeVoiceError('Thread-Id is required');
    const result=await voice.create(threadId,body.sdp,threadId);return reply.code(201).header('Location',`/wham/realtime/calls/${result.call.id}`).header('Content-Type','application/sdp').send(result.answerSdp);
  });
  if(options.registerLifecycle!==false) {app.addHook('onReady',async()=>voice.recover());app.addHook('onClose',async()=>voice.close());}return voice;
}
