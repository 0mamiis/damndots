import { isNoiseTranscript } from './voice-text.js';
import { randomUUID } from 'node:crypto';
import type { RealtimeCallProvider, RealtimeConfiguration, VoiceConnection } from './native-voice.js';
import { VoicePeerHost } from './voice-peer.js';

/**
 * Gerçek zamanlı ses API'si olmayan sağlayıcılar için ses hattı:
 * konuşma -> yazı (STT) -> Dot'un kendi modeli -> seslendirme (TTS).
 * Dot'un modeli dashboard'da seçilen herhangi bir özel model olabilir; ses tarafı yalnızca OpenAI uyumlu
 * /audio/transcriptions ve /audio/speech uçlarını (veya ses girdili sohbet modelini) kullanır.
 */
export interface PipelineDependencies {
  transcribe(wav:Buffer):Promise<string>;
  speak(text:string,signal:AbortSignal,callId?:string):Promise<{audio:Buffer;mimeType:string;streamed?:boolean}>;
  closeSpeaker?(callId:string):Promise<void>;
  prepareSpeaker?(callId:string):Promise<void>;
  configuration():RealtimeConfiguration|Promise<RealtimeConfiguration>;
  host?:VoicePeerHost;
}
type Emit=(event:Record<string,any>)=>void;
interface Call {
  id:string;closed:boolean;onEvent?:Emit;waiting:Buffer[];chain:Promise<void>;
  pending:string|null;speech?:AbortController;
}
const READ_ALOUD='Read this text aloud exactly: ';

/** Konuşulacak metni sadeleştirir: biçim işaretlerini ve uzun kod/uzun metinleri atar. */
export function speakable(text:string,limit=600):string {
  let t=String(text??'').replace(/```[\s\S]*?```/g,' ').replace(/`([^`]+)`/g,'$1').replace(/!\[[^\]]*\]\([^)]*\)/g,' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/https?:\/\/\S+/g,' ').replace(/^[#>\-*+\s]+/gm,'').replace(/[*_~|]/g,'').replace(/\s+/g,' ').trim();
  if(t.length<=limit) return t;
  const cut=t.slice(0,limit),end=Math.max(cut.lastIndexOf('. '),cut.lastIndexOf('! '),cut.lastIndexOf('? '));
  return (end>limit*0.4?cut.slice(0,end+1):cut).trim();
}

export class PipelineRealtimeProvider implements RealtimeCallProvider {
  static readonly prefix='rtc_pipe_';
  private calls=new Map<string,Call>();
  private host:VoicePeerHost;
  constructor(private deps:PipelineDependencies) {this.host=deps.host??new VoicePeerHost();}
  configuration():RealtimeConfiguration|Promise<RealtimeConfiguration> {return this.deps.configuration();}
  pipelineCall(callId:string):boolean {return callId.startsWith(PipelineRealtimeProvider.prefix);}
  async create(sdp:string,_session:Record<string,unknown>,signal:AbortSignal):Promise<{callId:string;answerSdp:string}> {
    signal.throwIfAborted();
    const call:Call={id:PipelineRealtimeProvider.prefix+randomUUID().replace(/-/g,''),closed:false,waiting:[],chain:Promise.resolve(),pending:null};
    const answerSdp=await this.host.offer(call.id,sdp,{
      onUtterance:(wav,ms)=>this.utterance(call,wav,ms),
      // Kullanıcı konuşmaya başlayınca asistanın sesi kesilir.
      onSpeechStart:()=>{call.speech?.abort();void this.host.stopPlayback(call.id);},
      onState:state=>{if(['failed','closed'].includes(state)&&!call.closed) call.onEvent?.({type:'transport.closed',reason:'Voice peer disconnected'});}
    });
    this.calls.set(call.id,call);
    void this.deps.prepareSpeaker?.(call.id).catch(()=>{});
    return {callId:call.id,answerSdp};
  }
  async attach(callId:string,_session:Record<string,unknown>,onEvent:Emit,signal:AbortSignal):Promise<VoiceConnection> {
    const call=this.calls.get(callId);if(!call||call.closed) throw new Error('Voice call is no longer available');
    signal.throwIfAborted();call.onEvent=onEvent;
    const waiting=call.waiting.splice(0);for(const wav of waiting) this.utterance(call,wav);
    return {send:event=>this.handle(call,event),close:()=>void this.drop(call)};
  }
  async hangup(callId:string):Promise<void> {const call=this.calls.get(callId);if(call) await this.drop(call);}
  private async drop(call:Call):Promise<void> {
    if(call.closed) return;call.closed=true;call.speech?.abort();this.calls.delete(call.id);await this.deps.closeSpeaker?.(call.id);await this.host.close(call.id);
  }
  private emit(call:Call,event:Record<string,any>):void {if(!call.closed) call.onEvent?.(event);}
  private utterance(call:Call,wav:Buffer,voicedMs?:number):void {
    if(call.closed) return;
    if(!call.onEvent){if(call.waiting.length<5) call.waiting.push(wav);return;}
    call.chain=call.chain.then(async()=>{
      if(call.closed) return;
      let text:string;
      try {text=(await this.deps.transcribe(wav)).trim();}
      catch(error) {this.emit(call,{type:'error',error:{message:'Speech recognition failed: '+(error instanceof Error?error.message:'unknown error')}});return;}
      // Whisper benzeri modeller sessizlikte kısa uydurma metinler üretebilir.
      if(text.replace(/[^\p{L}\p{N}]/gu,'').length<2) return;
      if(isNoiseTranscript(text,voicedMs!=null?voicedMs/1000:10))return;this.submit(call,text);
    }).catch(()=>{});
  }
  /** Kullanıcı cümlesini yazıya geçirir ve Dot'a görev olarak verir (mevcut sesli arama araç hattı üzerinden). */
  private submit(call:Call,text:string):void {
    const itemId='item_'+randomUUID();
    this.emit(call,{type:'conversation.item.input_audio_transcription.completed',item_id:itemId,transcript:text});
    this.emit(call,{type:'response.output_item.done',item:{type:'function_call',name:'dot_submit_task',call_id:'vc_'+randomUUID(),arguments:JSON.stringify({input:text})}});
  }
  private handle(call:Call,event:Record<string,unknown>):void {
    if(call.closed) return;
    if(event.type==='conversation.item.create') {
      const item=event.item as Record<string,any>|undefined;if(!item) return;
      if(item.type==='function_call_output') {
        let out:any=item.output;try {out=typeof out==='string'?JSON.parse(out):out;} catch { /* plain text */ }
        const text=typeof out==='string'?out:out?.result??(out?.error?String(out.error):'');
        call.pending=typeof text==='string'?text:JSON.stringify(text);
      } else if(item.type==='message'&&item.role==='user') {
        const value=String(item.content?.find?.((c:any)=>typeof c.text==='string')?.text??'');
        if(value.startsWith(READ_ALOUD)) call.pending=value.slice(READ_ALOUD.length);
        else if(value.trim()) call.chain=call.chain.then(()=>this.submit(call,value.trim()));
      }
    } else if(event.type==='response.create'&&call.pending!==null) {
      const text=call.pending;call.pending=null;
      void this.say(call,text);
    }
  }
  private async say(call:Call,raw:string):Promise<void> {
    const text=speakable(raw);if(!text||call.closed) return;
    call.speech?.abort();const control=new AbortController();call.speech=control;
    const id='resp_'+randomUUID();
    this.emit(call,{type:'response.output_audio_transcript.done',response_id:id,item_id:id,transcript:text});
    try {
      const speech=await this.deps.speak(text,control.signal,call.id);
      if(control.signal.aborted||call.closed) return;
      if(!speech.streamed)await this.host.play(call.id,speech.audio,control.signal);
    } catch(error) {
      if(!control.signal.aborted) this.emit(call,{type:'error',error:{message:'Speech synthesis failed: '+(error instanceof Error?error.message:'unknown error')}});
    } finally {if(call.speech===control) call.speech=undefined;}
  }
  async shutdown():Promise<void> {for(const call of [...this.calls.values()]) await this.drop(call);await this.host.shutdown();}
}

/** Ayara göre gerçek zamanlı API veya ses hattı kullanır; arama kimliği hangi sağlayıcıya ait olduğunu belirler. */
export class ModalRealtimeProvider implements RealtimeCallProvider {
  constructor(private realtime:RealtimeCallProvider,private pipeline:PipelineRealtimeProvider,private mode:()=>'realtime'|'pipeline') {}
  configuration():RealtimeConfiguration|Promise<RealtimeConfiguration> {return this.realtime.configuration();}
  pipelineCall(callId:string):boolean {return this.pipeline.pipelineCall(callId);}
  create(sdp:string,session:Record<string,unknown>,signal:AbortSignal) {return (this.mode()==='pipeline'?this.pipeline:this.realtime).create(sdp,session,signal);}
  attach(callId:string,session:Record<string,unknown>,onEvent:(event:Record<string,any>)=>void,signal:AbortSignal) {return this.owner(callId).attach(callId,session,onEvent,signal);}
  connect(session:Record<string,unknown>,onEvent:(event:Record<string,any>)=>void,signal:AbortSignal) {
    if(!this.realtime.connect) throw new Error('Realtime WebSocket audio is not supported');return this.realtime.connect(session,onEvent,signal);
  }
  hangup(callId:string,signal:AbortSignal) {return this.owner(callId).hangup(callId,signal);}
  private owner(callId:string):RealtimeCallProvider {return this.pipeline.pipelineCall(callId)?this.pipeline:this.realtime;}
}
