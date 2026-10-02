import { randomUUID } from 'node:crypto';
import type { Computer, RecordStore, RunInput, RunResult, RunnerHooks, TaskRunner } from '@dots/contracts';
import type { AuthService } from './auth.js';
import {dotBrowserSession} from './browser-session.js';
export interface WorkerJob {id:string;computerId:string;kind:'codex'|'browser'|'filesystem'|'rpc'|'stream'|'desktop';payload:Record<string,unknown>;status:'queued'|'running'|'completed'|'failed'|'cancelled';result:unknown;error:string|null;createdAt:string;updatedAt:string;leaseUntil:number|null;}
export class WorkerError extends Error {constructor(message:string,readonly statusCode=400){super(message);}}
type LiveJob={resolve:(result:any)=>void;reject:(err:Error)=>void;hooks?:RunnerHooks;signal?:AbortSignal;off?:()=>void;};
export class WorkerBroker {
  private live=new Map<string,LiveJob>();
  private timer:ReturnType<typeof setInterval>;
  constructor(private store:RecordStore,private auth:AuthService,private options:{onlineMs?:number;emit?:(type:string,data:Record<string,unknown>)=>void;onToolCall?:(name:string,args:Record<string,unknown>,input:RunInput,signal:AbortSignal)=>Promise<unknown>}={}) {
    for(const j of store.list<WorkerJob>('worker_jobs').filter(j=>['queued','running'].includes(j.status)))store.put('worker_jobs',{...j,status:'failed',error:'Server restarted before job acknowledgement',updatedAt:new Date().toISOString()});
    this.timer=setInterval(()=>this.expire(),5000);this.timer.unref();
  }
  private emit(type:string,data:Record<string,unknown>){this.options.emit?.(type,data);}
  register(input:{token:string;name:string;platform:string;roots:string[];capabilities:string[]}):{computerId:string;token:string} {
    const claims=this.auth.consume(input.token,'enroll-worker');if(!claims)throw new WorkerError('Enrollment token expired or already used',401);
    if(!input.name?.trim()||!Array.isArray(input.roots)||input.roots.some(r=>typeof r!=='string')||!Array.isArray(input.capabilities))throw new WorkerError('Invalid computer description');
    const id=randomUUID(),now=new Date().toISOString();
    const computer:Computer={id,name:input.name,platform:input.platform,roots:input.roots,capabilities:input.capabilities,state:'online',lastSeenAt:now,createdAt:now};
    this.store.put('computers',computer);this.emit('computer.registered',{computer});
    return {computerId:id,token:this.auth.issue('worker',id,365*86400)};
  }
  list():Computer[]{return this.store.list<Computer>('computers').map(c=>({...c,state:Date.now()-Date.parse(c.lastSeenAt)<(this.options.onlineMs||45000)?'online':'offline'}));}
  get(id:string):Computer {const c=this.list().find(c=>c.id===id);if(!c)throw new WorkerError('Computer not found',404);return c;}
  heartbeat(id:string,activeIds:string[]=[]):void {const c=this.get(id);this.store.put('computers',{...c,state:'online',lastSeenAt:new Date().toISOString()});for(const job of this.store.list<WorkerJob>('worker_jobs').filter(j=>j.computerId===id&&j.status==='running'&&activeIds.includes(j.id)))this.store.put('worker_jobs',{...job,leaseUntil:Date.now()+60000});}
  revoke(id:string):void {this.get(id);this.auth.revokeIdentity(id);for(const j of this.store.list<WorkerJob>('worker_jobs').filter(j=>j.computerId===id&&['queued','running'].includes(j.status)))this.cancel(j.id,'Computer access revoked');this.store.delete('computers',id);this.emit('computer.revoked',{computerId:id});}
  queue(computerId:string,kind:WorkerJob['kind'],payload:Record<string,unknown>):WorkerJob {
    const c=this.get(computerId);if(c.state!=='online')throw new WorkerError('Computer is offline',409);
    if(!c.capabilities.includes(kind==='codex'||kind==='rpc'?'codex':kind==='stream'?'browser':kind))throw new WorkerError('Computer does not support this operation',409);
    if(c.capabilities.includes('desktop')&&(kind==='codex'||kind==='rpc')){
      const input=payload.input as RunInput|undefined,request=payload.request as {params?:{threadId?:string}}|undefined;
      const dotId=input?.dot.id??this.store.list<any>('tasks').filter(t=>t.threadId===request?.params?.threadId&&t.computerId===computerId).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0]?.dotId;
      if(!dotId)throw new WorkerError('Desktop thread has no proven Dot owner',409);
      if(input&&(input.task.dotId!==dotId||input.task.computerId!==computerId||!this.store.get('dots',dotId)))throw new WorkerError('Desktop task does not belong to this Dot and computer',403);
      payload={...payload,desktopSessionId:dotBrowserSession(this.store,dotId,computerId).sessionId};
      if(input)payload.contextHistory=this.store.list<any>('messages').filter(m=>m.dotId===dotId&&m.taskId!==input.task.id).slice(-80).map(m=>`${m.role}: ${m.text}`).join('\n\n').slice(-200000);
    }
    const now=new Date().toISOString(),job:WorkerJob={id:randomUUID(),computerId,kind,payload,status:'queued',result:null,error:null,createdAt:now,updatedAt:now,leaseUntil:null};
    this.store.put('worker_jobs',job);this.emit('worker.job.queued',{id:job.id,computerId});return job;
  }
  getJob(id:string):WorkerJob {const j=this.store.get<WorkerJob>('worker_jobs',id);if(!j)throw new WorkerError('Job not found',404);return j;}
  next(computerId:string):WorkerJob|undefined {
    this.heartbeat(computerId);
    return this.store.transaction(()=>{const job=this.store.list<WorkerJob>('worker_jobs').find(j=>j.computerId===computerId&&j.status==='queued');if(!job)return;
      const running={...job,status:'running' as const,updatedAt:new Date().toISOString(),leaseUntil:Date.now()+60000};this.store.put('worker_jobs',running);return running;});
  }
  async execute(computerId:string,kind:WorkerJob['kind'],payload:Record<string,unknown>,hooks?:RunnerHooks,signal?:AbortSignal):Promise<any> {
    signal?.throwIfAborted();const job=this.queue(computerId,kind,payload);
    return new Promise((resolve,reject)=>{const onAbort=()=>this.cancel(job.id,'Operation aborted');const off=()=>signal?.removeEventListener('abort',onAbort);
      this.live.set(job.id,{resolve,reject,hooks,signal,off});signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)onAbort();});
  }
  async event(computerId:string,id:string,event:{type:string;data:any}):Promise<unknown> {
    const j=this.getJob(id);if(j.computerId!==computerId)throw new WorkerError('Job does not belong to computer',403);if(j.status!=='running')throw new WorkerError('Job is no longer active',409);
    this.store.put('worker_jobs',{...j,leaseUntil:Date.now()+60000});const hooks=this.live.get(id)?.hooks;
    switch(event.type){case'thread':hooks?.onThread(String(event.data));break;case'turn':hooks?.onTurn(String(event.data));break;case'delta':hooks?.onDelta(String(event.data));break;
      case'activity':hooks?.onActivity(event.data.type,event.data.message,event.data.data);break;
      case'output':hooks?.onOutput({...event.data,computerId});break;
      case'approval':return {approved:hooks?await hooks.onApproval(event.data):false};
      case'user_input':return {resolution:hooks?.onUserInput?await hooks.onUserInput(event.data):null};
      case'tool':{const input=(j.payload.input as unknown) as RunInput;if(!input||!this.options.onToolCall)throw new WorkerError('Remote tools are not configured',409);return {result:await this.options.onToolCall(event.data.name,event.data.arguments,input,this.live.get(id)?.signal||new AbortController().signal)};}
      default:throw new WorkerError('Unknown worker event');}
    return {ok:true};
  }
  finish(computerId:string,id:string,result:unknown,error?:string):void {
    const j=this.getJob(id);if(j.computerId!==computerId)throw new WorkerError('Job does not belong to computer',403);if(j.status!=='running')throw new WorkerError('Job is no longer active',409);
    this.store.put('worker_jobs',{...j,status:error?'failed':'completed',result,error:error||null,leaseUntil:null,updatedAt:new Date().toISOString()});
    const live=this.live.get(id);live?.off?.();this.live.delete(id);if(error)live?.reject(new WorkerError(error,502));else live?.resolve(result);
    this.emit('worker.job.completed',{id,computerId,error:error||null});
  }
  cancel(id:string,reason:string):void {const j=this.getJob(id);if(!['queued','running'].includes(j.status))return;this.store.put('worker_jobs',{...j,status:'cancelled',error:reason,leaseUntil:null,updatedAt:new Date().toISOString()});const l=this.live.get(id);l?.off?.();this.live.delete(id);l?.reject(new WorkerError(reason,409));}
  active(computerId:string):string[]{return this.store.list<WorkerJob>('worker_jobs').filter(j=>j.computerId===computerId&&j.status==='running').map(j=>j.id);}
  executingCodex(computerId:string):boolean{return this.store.list<WorkerJob>('worker_jobs').some(j=>j.computerId===computerId&&j.kind==='codex'&&j.status==='running');}
  private expire(){for(const j of this.store.list<WorkerJob>('worker_jobs').filter(j=>j.status==='running'&&j.leaseUntil!<Date.now()))this.cancel(j.id,'Computer heartbeat expired');}
  close(){clearInterval(this.timer);for(const id of this.live.keys())this.cancel(id,'Server stopped');}
}
export class RoutingRunner implements TaskRunner {
  constructor(private local:TaskRunner,private workers:WorkerBroker,private tools?:(input:RunInput)=>Promise<unknown>){}
  async run(input:RunInput,hooks:RunnerHooks,signal:AbortSignal):Promise<RunResult>{
    if(!input.task.computerId)return this.local.run(input,hooks,signal);
    const computer=this.workers.get(input.task.computerId);const routed={...input,task:{...input.task,cwd:input.task.cwd||computer.roots[0]||null}};
    return this.workers.execute(input.task.computerId,'codex',{input:routed,tools:this.tools?await this.tools(input):[]},hooks,signal);
  }
}
