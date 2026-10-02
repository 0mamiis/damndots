import { hostname, platform } from 'node:os';
import {allowsPlainHttp} from '@dots/contracts/network';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RunInput, RunnerHooks, ToolDefinition } from '@dots/contracts';
import { AppServerRunner,RpcClient } from '../../server/src/runtime/runner.js';
import { WorkspaceFilesystem } from './filesystem.js';
import { BrowserExecutor } from './browser.js';
import { BrowserStream } from './stream.js';
import {startManagedAppServer,type ManagedAppServer} from './managed-appserver.js';
import {LinuxDesktop} from './desktop.js';
import {WindowsDesktop} from './windows-desktop.js';
import type {ComputerDesktop} from './desktop-contract.js';
import {createHash} from 'node:crypto';
interface Credentials {computerId:string;token:string;server:string;}
interface Job {id:string;kind:string;payload:Record<string,any>;}
export interface WorkerOptions {server:string;enrollment?:string;dataDir:string;roots:string[];appServerUrl?:string;browserExecutable?:string;name?:string;pollMs?:number;desktop?:boolean;computerMode?:'pc'|'browser';}
export class ComputerWorker {
  private credentials:Credentials|undefined;
  private active=new Map<string,AbortController>();
  private stopped=false;
  private cleaning?:Promise<void>;
  private managed:ManagedAppServer|undefined;
  private desktopServers=new Map<string,Promise<ManagedAppServer>>();
  readonly desktop?:ComputerDesktop;
  private linux?:LinuxDesktop;
  readonly filesystem:WorkspaceFilesystem;
  readonly browser:BrowserExecutor;
  readonly stream:BrowserStream;
  constructor(readonly options:WorkerOptions){
    const url=new URL(options.server);if(url.username||url.password||(url.protocol!=='https:'&&!allowsPlainHttp(url.hostname)))throw new Error('Remote server must use HTTPS, a loopback SSH tunnel or a Tailscale address');
    this.filesystem=new WorkspaceFilesystem(options.roots.map(r=>resolve(r)));
    if(options.desktop)this.desktop=this.linux=new LinuxDesktop(join(options.dataDir,'desktop'),options.roots[0]);
    else if(process.platform==='win32'&&options.computerMode!=='browser')this.desktop=new WindowsDesktop(join(options.dataDir,'desktop'),options.roots[0]);
    this.browser=new BrowserExecutor(join(options.dataDir,'browser'),options.browserExecutable,this.linux?{environment:id=>this.linux!.environment(id),args:id=>this.linux!.chromeArgs(id),home:id=>this.linux!.home(id),control:id=>this.linux!.control(id),setControl:(id,control)=>this.linux!.setControl(id,control)}:undefined);
    if(this.linux)this.linux.browserOpen=async id=>{const s=await this.browser.attach(id);await s.page.bringToFront();};
    this.stream=new BrowserStream(this.browser,options.browserExecutable,this.desktop);
  }
  private async request<T=any>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{
    const response=await fetch(new URL(path,this.options.server),{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(this.credentials?{authorization:'Bearer '+this.credentials.token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal,redirect:'error'});
    if(response.status===204)return undefined as T;
    if(!response.ok){const detail=await response.json().catch(()=>({}));throw new Error(`Worker request HTTP ${response.status}: ${detail.error||'request rejected'}`);}
    return response.json() as Promise<T>;
  }
  async enroll():Promise<void>{
    await mkdir(this.options.dataDir,{recursive:true});for(const r of this.options.roots)await mkdir(resolve(r),{recursive:true});
    const file=join(this.options.dataDir,'computer.json');
    try{const previous=JSON.parse(await readFile(file,'utf8')) as Credentials;if(previous.server===this.options.server)this.credentials=previous;}catch{}
    if(this.credentials){await this.request('/worker/describe',{roots:this.options.roots.map(r=>resolve(r)),capabilities:['codex','browser','filesystem',...this.desktop?['desktop']:[]]});return;}
    if(!this.options.enrollment)throw new Error('Computer enrollment required');
    const result=await this.request<Credentials>('/worker/register',{token:this.options.enrollment,name:this.options.name||hostname(),platform:platform(),roots:this.options.roots.map(r=>resolve(r)),capabilities:['codex','browser','filesystem',...this.desktop?['desktop']:[]]});
    this.credentials={...result,server:this.options.server};await writeFile(file,JSON.stringify(this.credentials,null,2),{mode:0o600});
  }
  async start():Promise<void>{
    await this.enroll();
    if(this.desktop)await this.desktop.start();
    if(!this.linux){this.managed=await startManagedAppServer({server:this.options.server,workerToken:this.credentials!.token,dataDir:this.options.dataDir,appServerUrl:this.options.appServerUrl,model:process.env.DOTS_WORKER_MODEL||process.env.DOTS_MODEL||'gpt-6.1-sol',childCLIPath:process.env.DOTS_CODEX_CLI});this.options.appServerUrl=this.managed.url;}
    this.stopped=false;let misses=0;
    const heartbeat=setInterval(()=>{void this.request<{activeJobs:string[]}>('/worker/heartbeat',{activeJobIds:[...this.active.keys()]}).then(r=>{misses=0;for(const [id,controller] of this.active)if(!r.activeJobs.includes(id))controller.abort(new Error('Server cancelled job'));}).catch(()=>{if(++misses>=3)for(const controller of this.active.values())controller.abort(new Error('Server connection lost'));});},5000);heartbeat.unref();
    try{while(!this.stopped){if(this.active.size<3){try{const job=await this.request<Job>('/worker/jobs/next');if(job){const controller=new AbortController();this.active.set(job.id,controller);void this.execute(job,controller).finally(()=>this.active.delete(job.id));}}catch{await new Promise(r=>setTimeout(r,1000));}}
      await new Promise(r=>setTimeout(r,this.options.pollMs||350));}}
    finally{clearInterval(heartbeat);await this.cleanup();}
  }
  private async appServer(sessionId?:string):Promise<string>{
    if(!this.linux)return this.options.appServerUrl||'ws://127.0.0.1:9911';
    if(!sessionId)throw new Error('Desktop task has no assigned Dot session');
    let pending=this.desktopServers.get(sessionId);if(!pending){pending=(async()=>{const env=await this.linux!.environment(sessionId);return startManagedAppServer({server:this.options.server,workerToken:this.credentials!.token,dataDir:join(this.options.dataDir,'codex',sessionId),model:process.env.DOTS_WORKER_MODEL||'gpt-6.1-sol',childCLIPath:process.env.DOTS_CODEX_CLI,env,startupTimeoutMs:60000});})();this.desktopServers.set(sessionId,pending);pending.catch(()=>this.desktopServers.delete(sessionId));}
    return (await pending).url;
  }
  private async execute(job:Job,controller:AbortController):Promise<void>{
    const signal=controller.signal;let sends=Promise.resolve();
    const event=(type:string,data:unknown)=>this.request<any>(`/worker/jobs/${job.id}/events`,{type,data},signal);
    const emit=(type:string,data:unknown)=>{sends=sends.then(()=>event(type,data));sends.catch(()=>controller.abort(new Error('Job event delivery failed')));};
    try{let result:unknown;
      if(job.kind==='browser')result=await this.browser.execute(job.payload,job.payload.actor||'user');
      else if(job.kind==='desktop'){if(!this.desktop)throw new Error('This computer does not have a Linux desktop');result=await this.desktop.execute(job.payload,job.payload.actor||'agent');}
      else if(job.kind==='stream')result=await this.stream.offer(job.payload as {sessionId:string;offer:string});
      else if(job.kind==='filesystem'){const p=job.payload;switch(p.action){case'read':result=await this.filesystem.read(p.path);break;case'write':result=await this.filesystem.write(p.path,p.data);break;case'list':result=await this.filesystem.list(p.path);break;default:throw new Error('Unknown filesystem operation');}}
      else if(job.kind==='rpc'){const request=job.payload.request;if(!['thread/read','thread/turns/list','thread/items/list','thread/name/set','thread/archive','thread/unarchive','thread/resume','turn/interrupt','thread/loaded/list'].includes(request?.method))throw new Error('RPC method is not allowed through computer read routing');const rpc=new RpcClient({url:await this.appServer(job.payload.desktopSessionId)});try{await rpc.connect();await rpc.request('initialize',{clientInfo:{name:'dots_worker_read',version:'0.1.0'},capabilities:{experimentalApi:true}});rpc.notify('initialized');result=await rpc.request(request.method,request.params||{});}finally{rpc.close();}}
      else if(job.kind==='codex'){
        const input=structuredClone(job.payload.input) as RunInput;input.task.cwd=await this.filesystem.permitted(input.task.cwd||this.options.roots[0]);
        const attachmentRoot=join(this.options.dataDir,'attachments');await mkdir(attachmentRoot,{recursive:true});
        for(const a of input.task.attachments){const response=await fetch(new URL('/worker/attachments/'+encodeURIComponent(a.id),this.options.server),{headers:{authorization:'Bearer '+this.credentials!.token},signal,redirect:'error'});if(!response.ok)throw new Error('Attachment could not be downloaded');const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>32*1024*1024)throw new Error('Attachment too large');a.path=join(attachmentRoot,a.id);await writeFile(a.path,bytes,{mode:0o600});}
        const hooks:RunnerHooks={onThread:id=>emit('thread',id),onTurn:id=>emit('turn',id),onDelta:text=>emit('delta',text),onActivity:(type,message,data)=>emit('activity',{type,message,data}),onOutput:output=>emit('output',output),onApproval:async request=>{await sends;return (await event('approval',request)).approved===true;},onUserInput:async request=>{await sends;return (await event('user_input',request)).resolution||null;}};
        if(this.desktop&&job.payload.desktopSessionId){await this.desktop.ensure(job.payload.desktopSessionId);await this.desktop.appearance(job.payload.desktopSessionId,{name:input.dot.name,avatarManifest:input.dot.avatarManifest});}
        if(this.desktop)input.dot.instructions=[input.dot.instructions,this.linux?'Computer context: isolated Linux desktop on the owner’s PC. Workspace: /home/dot/Workspace. Use dot_desktop_action for full screenshots and native apps.':'Computer context: this is the owner’s actual connected Windows PC, primary display. Use dot_desktop_action to screenshot/click/type/press the real desktop and applications. Coordinates refer to the scaled 1280x800 full-screen image. Browser tools operate a separate automation browser; use desktop tools for the browser already open on the PC. Respect user takeover.','The computer cannot run while the PC is off.'].filter(Boolean).join('\n\n');
        const versionsFile=this.desktop?join(this.options.dataDir,'codex',job.payload.desktopSessionId,'tool-versions.json'):undefined;
        let versions:Record<string,string>={};if(versionsFile)try{versions=JSON.parse(await readFile(versionsFile,'utf8'));}catch{}
        const signature=createHash('sha256').update(JSON.stringify(job.payload.tools||[])).digest('hex');
        const runner=new AppServerRunner({url:await this.appServer(job.payload.desktopSessionId),cwd:input.task.cwd,attachmentRoots:[attachmentRoot],tools:()=>job.payload.tools as ToolDefinition[]||[],...versionsFile?{threadHasTools:(id:string)=>versions[id]===signature,contextHistory:()=>String(job.payload.contextHistory||''),onToolsThread:(id:string)=>{versions[id]=signature;emit('activity',{type:'thread.tools.registered',message:'Desktop thread tools registered',data:{threadId:id}});void writeFile(versionsFile,JSON.stringify(versions),{mode:0o600}).catch(()=>{});}}:{},onToolCall:async(name,args)=>{await sends;return (await event('tool',{name,arguments:args})).result;}});
        result=await runner.run(input,hooks,signal);
      }else throw new Error('Unknown worker job');
      await sends;signal.throwIfAborted();await this.request(`/worker/jobs/${job.id}/result`,{result},signal);
    }catch(error){await this.request(`/worker/jobs/${job.id}/result`,{error:(error as Error).message}).catch(()=>{});}
  }
  private cleanup(){return this.cleaning??=(async()=>{await this.stream.close();await this.browser.close();await this.managed?.close();await Promise.allSettled([...this.desktopServers.values()].map(async p=>(await p).close()));this.desktopServers.clear();await this.desktop?.close();})();}
  async stop():Promise<void>{this.stopped=true;for(const c of this.active.values())c.abort(new Error('Computer worker stopped'));await this.cleanup();}
}
