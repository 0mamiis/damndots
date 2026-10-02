import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { VoicePeerHost } from './voice-peer.js';

const backend='https://chatgpt.com/backend-api';
const voices=new Set(['juniper','maple','spruce','ember','vale','breeze','arbor','sol','cove']);
export function codexVoiceSlug(value:string):string {
  const slug=({fathom:'arbor',orbit:'spruce',glimmer:'sol',sky:'juniper'} as Record<string,string>)[value]??value;
  if(!voices.has(slug))throw new Error('The selected Codex voice is not supported by this installed version');
  return slug;
}

/** A private stdio client for the installed CLI. It creates only ephemeral speech threads, never an app window. */
class SpeechRpc {
  private child:ChildProcessWithoutNullStreams;
  private sequence=0;
  private pending=new Map<number,{resolve:(r:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private listeners=new Set<(method:string,params:any)=>void>();
  constructor(cli:string,mainHome:string) {
    const env={...process.env,CODEX_HOME:mainHome};
    for(const key of ['CODEX_API_BASE_URL','CODEX_CLI_PATH','CODEX_APP_SERVER_FORCE_CLI'])delete (env as NodeJS.ProcessEnv)[key];
    this.child=spawn(cli,['app-server'],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.child.stderr.resume();
    this.child.stdin.on('error',()=>this.fail(new Error('The Codex speech connection stopped')));
    createInterface({input:this.child.stdout}).on('line',line=>{
      let m:any;try{m=JSON.parse(line);}catch{return;}
      if(m.id!==undefined&&!m.method){const p=this.pending.get(m.id);if(p){this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}return;}
      if(m.id!==undefined&&m.method){this.child.stdin.write(JSON.stringify({id:m.id,error:{code:-32601,message:'Speech reader does not execute tools'}})+'\n');return;}
      if(m.method)for(const listener of this.listeners)listener(m.method,m.params??{});
    });
    this.child.once('error',()=>this.fail(new Error('The installed Codex speech client could not start')));
    this.child.once('exit',()=>this.fail(new Error('The Codex speech client stopped')));
  }
  async init(){await this.request('initialize',{clientInfo:{name:'codex_desktop',version:'1'},capabilities:{experimentalApi:true}});this.child.stdin.write('{"method":"initialized"}\n');}
  request(method:string,params:Record<string,unknown>={},timeout=20000):Promise<any>{
    return new Promise((resolve,reject)=>{if(this.child.stdin.destroyed){reject(new Error('Codex speech client is closed'));return;}const id=++this.sequence,timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Codex speech request timed out'));},timeout);this.pending.set(id,{resolve,reject,timer});try{this.child.stdin.write(JSON.stringify({id,method,params})+'\n');}catch(e){clearTimeout(timer);this.pending.delete(id);reject(e);}});
  }
  subscribe(listener:(method:string,params:any)=>void){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  private fail(error:Error){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();for(const listener of this.listeners)listener('speech/connectionError',{message:error.message});}
  close(){this.fail(new Error('Speech session closed'));this.child.stdin.end();this.child.kill();this.listeners.clear();}
}

interface Speaker {id:string;voice:string;rpc:SpeechRpc;threadId:string;closed:boolean;ready:Promise<void>;expected?:string;activeTurn?:string;ignoredTurn?:string;complete?:(error?:Error)=>void;}
export interface CodexSpeechOptions {
  host:VoicePeerHost;
  nativeDir:string;
  mainHome?:string;
  fetch?:typeof fetch;
}

/** Relays speech from the same account-backed service used by the installed desktop app, with its current voice selection. */
export class CodexSpeech {
  private speakers=new Map<string,Speaker>();
  private mainHome:string;
  constructor(private options:CodexSpeechOptions){this.mainHome=options.mainHome??process.env.DOTS_MAIN_CODEX_HOME??join(homedir(),'.codex');}
  private async headers():Promise<Record<string,string>>{
    const [auth,context]=await Promise.all([
      readFile(join(this.mainHome,'auth.json'),'utf8').then(JSON.parse),
      readFile(join(this.options.nativeDir,'codex-speech-headers.json'),'utf8').then(JSON.parse).catch(()=>{throw new Error('Open Codex Settings > Voice once to connect the selected voice');})
    ]);
    if(auth.auth_mode!=='chatgpt'||typeof auth.tokens?.access_token!=='string')throw new Error('Sign in to Codex with ChatGPT to use its selected voice');
    return {...context,'chatgpt-account-id':auth.tokens.account_id,authorization:'Bearer '+auth.tokens.access_token,'content-type':'application/json'};
  }
  private async request(path:string,init:RequestInit,signal:AbortSignal):Promise<Response>{
    const headers=await this.headers();const r=await (this.options.fetch??fetch)(backend+path,{...init,headers:{...headers,...init.headers},redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(25000)])});
    if(!r.ok){await r.body?.cancel();throw new Error(`Codex voice service rejected the request (${r.status})`);}
    return r;
  }
  async selectedVoice(signal:AbortSignal):Promise<string>{
    const response=await this.request('/settings/voices?voice_mode=advanced&spoken_language=tr',{method:'GET'},signal);
    const value=await response.json() as any;if(typeof value.selected!=='string')throw new Error('Codex has no selected voice');return codexVoiceSlug(value.selected);
  }
  private create(id:string,voice:string,signal:AbortSignal):Speaker{
    const speaker:Speaker={id,voice,rpc:undefined as any,threadId:'',closed:false,ready:Promise.resolve()};
    this.speakers.set(id,speaker);
    speaker.ready=(async()=>{
      const manifest=JSON.parse(await readFile(join(this.options.nativeDir,'cli-bridge.json'),'utf8'));
      if(speaker.closed||signal.aborted)throw new Error('Speech session cancelled');
      speaker.rpc=new SpeechRpc(manifest.realCli,this.mainHome);await speaker.rpc.init();
      const thread=await speaker.rpc.request('thread/start',{ephemeral:true,cwd:process.cwd(),approvalPolicy:'never',sandbox:'read-only'});speaker.threadId=thread.thread.id;
      speaker.rpc.subscribe((method,params)=>{
        if(method==='speech/connectionError'){if(!speaker.closed)speaker.complete?.(new Error(params.message));return;}
        if(params.threadId!==speaker.threadId)return;
        if(method==='thread/realtime/error')speaker.complete?.(new Error(params.message||'Codex speech failed'));
        if(method==='thread/realtime/closed'&&!speaker.closed)speaker.complete?.(new Error('Codex speech connection closed'));
        if(method==='thread/realtime/transcript/done'&&params.role==='assistant'&&speaker.expected){
          const normalize=(s:string)=>s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
          if(normalize(params.text??'')===normalize(speaker.expected)||(speaker.activeTurn&&speaker.activeTurn!==speaker.ignoredTurn))speaker.complete?.();
        }
      });
      const sdp=await this.options.host.officialOffer(id,event=>{
        if(event.type==='turn.created'&&event.turn?.role==='assistant')speaker.activeTurn=event.turn.id;
        if(event.type==='turn.done'&&event.turn?.role==='assistant'&&event.turn.id!==speaker.ignoredTurn)speaker.complete?.();
        if(event.type==='transport.failed')speaker.complete?.(new Error('Codex voice media connection failed'));
        if(event.type==='session.usage.updated'&&event.usage_limit?.status==='exceeded')speaker.complete?.(new Error('Codex voice usage limit reached'));
      });
      const session={audio:{output:{voice}},delegation:{type:'client'},initial_items:[],instructions:'You are the speech reader for a user-initiated Dot call. Remain silent until a trusted instruction tells you to read supplied text. Read that text exactly in its original language. Do not add answers, summaries, or tool calls.',model:'gpt-live-1-codex'};
      const result=await this.request('/wham/realtime/calls?intent=quicksilver&architecture=avas',{method:'POST',headers:{'OpenAI-Alpha':'quicksilver=v2','Thread-Id':speaker.threadId},body:JSON.stringify({sdp,session})},signal);
      const callId=result.headers.get('location')?.split('?')[0].split('/').pop(),answer=await result.text();
      if(!callId||!/^rtc_[A-Za-z0-9_-]+$/.test(callId)||!answer.startsWith('v=0'))throw new Error('Codex voice returned an invalid media answer');
      if(speaker.closed||signal.aborted)throw new Error('Speech session cancelled');
      await this.options.host.officialAnswer(id,answer);
      await speaker.rpc.request('thread/realtime/start',{threadId:speaker.threadId,outputModality:'audio',includeStartupContext:false,clientManagedHandoffs:true,transport:{type:'existingCall',callId},version:'v3'});
    })();
    return speaker;
  }
  /** Opens the speech session while the call is being set up, so the first reply does not wait for it. Failures surface on the first spoken reply. */
  async warm(id:string):Promise<void>{
    const control=new AbortController(),timer=setTimeout(()=>control.abort(),30000);
    try{
      const voice=await this.selectedVoice(control.signal);if(this.speakers.has(id))return;
      const speaker=this.create(id,voice,control.signal);await speaker.ready;
    }catch{await this.close(id);}finally{clearTimeout(timer);}
  }
  async speak(id:string,text:string,signal:AbortSignal):Promise<{audio:Buffer;mimeType:string;streamed:true}>{
    signal.throwIfAborted();const voice=await this.selectedVoice(signal);
    let speaker=this.speakers.get(id);if(speaker&&(speaker.voice!==voice||speaker.closed)){await this.close(id);speaker=undefined;}
    speaker??=this.create(id,voice,signal);const current=speaker;
    const abort=()=>{void this.close(id);};signal.addEventListener('abort',abort,{once:true});
    try{
      await current.ready;signal.throwIfAborted();await this.options.host.muteOfficial(id,false);
      await new Promise<void>((resolve,reject)=>{
        const timer=setTimeout(()=>finish(new Error('Codex did not finish speaking')),60000);
        const aborted=()=>finish(new Error('Speech interrupted'));
        const finish=(error?:Error)=>{clearTimeout(timer);signal.removeEventListener('abort',aborted);current.complete=undefined;error?reject(error):resolve();};
        current.expected=text;current.ignoredTurn=current.activeTurn;current.complete=finish;signal.addEventListener('abort',aborted,{once:true});
        current.rpc.request('thread/realtime/appendSpeech',{threadId:current.threadId,text:'Immediately say the following text exactly and in full, without adding any words. After it, remain silent until the next reading request. Text to read: '+JSON.stringify(text)}).catch(e=>finish(e));
      });
      return {audio:Buffer.alloc(0),mimeType:'audio/pcm',streamed:true};
    }catch(error){await this.close(id);throw error;}
    finally{signal.removeEventListener('abort',abort);}
  }
  async close(id:string):Promise<void>{
    const speaker=this.speakers.get(id);if(!speaker)return;this.speakers.delete(id);speaker.closed=true;speaker.complete?.(new Error('Speech session closed'));
    await this.options.host.closeOfficial(id);
    if(speaker.threadId&&speaker.rpc)await speaker.rpc.request('thread/realtime/stop',{threadId:speaker.threadId},1500).catch(()=>{});speaker.rpc?.close();
  }
  async shutdown(){await Promise.allSettled([...this.speakers.keys()].map(id=>this.close(id)));}
}
