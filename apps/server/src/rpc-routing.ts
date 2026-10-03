import type { Dot, RecordStore, RunnerHooks, Task } from '@dots/contracts';

export interface NativeRpcRequest {method:string;params?:Record<string,unknown>;}
export interface RpcWorkerExecutor {
  execute(computerId:string,kind:'rpc',payload:Record<string,unknown>,hooks?:RunnerHooks,signal?:AbortSignal):Promise<unknown>;
}
export interface NativeRpcRoutingOptions {
  store:RecordStore;
  workers:RpcWorkerExecutor;
  /** A proven root-thread host mapping. Selecting a dot computer alone is not proof. */
  resolveRootComputer?:(threadId:string)=>string|null|undefined|Promise<string|null|undefined>;
}
export type NativeRpcRoutingResult={handled:true;result:unknown}|{handled:false};
export interface RecordedThreadOwner {threadId:string;computerId:string|null;dotId:string;taskId:string;updatedAt:string;}
export class RpcRoutingError extends Error {
  constructor(message:string,readonly statusCode=409,readonly code=-32602) {super(message);}
}

/** Ordinary turn admission stays in OrbitRuntime. These operations address a persisted thread. */
export const REMOTE_THREAD_RPC_METHODS=Object.freeze([
  'thread/read',
  'thread/turns/list',
  'thread/items/list',
  'thread/name/set',
  'thread/archive',
  'thread/unarchive',
  'thread/resume',
  'turn/interrupt',
] as const);
const allowedMethods=new Set<string>(REMOTE_THREAD_RPC_METHODS);
const timestamp=(value:string):number=>{const parsed=Date.parse(value);return Number.isFinite(parsed)?parsed:0;};

function newestOwner(tasks:Task[]):RecordedThreadOwner|undefined {
  if(!tasks.length) return undefined;
  const ordered=[...tasks].sort((a,b)=>timestamp(b.updatedAt)-timestamp(a.updatedAt)||timestamp(b.createdAt)-timestamp(a.createdAt)||b.id.localeCompare(a.id));
  const newest=ordered[0];
  const equallyRecent=ordered.filter(task=>timestamp(task.updatedAt)===timestamp(newest.updatedAt)&&timestamp(task.createdAt)===timestamp(newest.createdAt));
  const owners=new Set(equallyRecent.map(task=>task.computerId??null));
  if(owners.size>1) throw new RpcRoutingError('Persisted thread has conflicting execution computers; reconcile its host before routing');
  return {threadId:newest.threadId!,computerId:newest.computerId??null,dotId:newest.dotId,taskId:newest.id,updatedAt:newest.updatedAt};
}

/** Metadata only, for merging actual worker thread/read results into a native index.
 * This does not manufacture App Server Thread DTOs from task records.
 */
export function listRecordedRemoteThreadOwners(store:RecordStore):Array<RecordedThreadOwner&{computerId:string}> {
  const groups=new Map<string,Task[]>();
  for(const task of store.list<Task>('tasks')) {
    if(typeof task.threadId!=='string'||!task.threadId) continue;
    const group=groups.get(task.threadId)??[];group.push(task);groups.set(task.threadId,group);
  }
  const result:Array<RecordedThreadOwner&{computerId:string}>=[];
  for(const tasks of groups.values()) {
    const owner=newestOwner(tasks);
    if(owner?.computerId) result.push({...owner,computerId:owner.computerId});
  }
  return result.sort((a,b)=>timestamp(b.updatedAt)-timestamp(a.updatedAt)||a.threadId.localeCompare(b.threadId));
}

/** Stateless routing: execution ownership comes from durable actual thread ids.
 * Offline/failed worker reads propagate their errors rather than silently reading
 * an unrelated central thread with the same id. Close the native socket by aborting
 * the supplied signal; WorkerBroker then cancels the corresponding job.
 */
export async function routeNativeRpc(request:NativeRpcRequest,options:NativeRpcRoutingOptions,signal?:AbortSignal):Promise<NativeRpcRoutingResult> {
  if(!allowedMethods.has(request.method)) return {handled:false};
  const params=request.params;
  if(!params||typeof params.threadId!=='string'||!params.threadId.trim()) return {handled:false};
  signal?.throwIfAborted();
  const threadId=params.threadId;
  const owner=newestOwner(options.store.list<Task>('tasks').filter(task=>task.threadId===threadId));
  // A recorded central owner is authoritative; never override it with a selected
  // computer or an older remote task. Root aliases may only fill an absent owner.
  const computerId=owner?owner.computerId:await options.resolveRootComputer?.(threadId);
  if(!computerId) return {handled:false};
  signal?.throwIfAborted();
  const result=await options.workers.execute(computerId,'rpc',{request:{method:request.method,params:structuredClone(params)}},undefined,signal);
  // Worker-created/migrated Dot roots may predate threadSource metadata.
  // Project their proven Dot identity so the native delegation renderer uses the Dot's name/avatar.
  // Keep ordinary delegated task DTOs and all real history/status fields untouched.
  const task=owner?options.store.get<Task>('tasks',owner.taskId):undefined;
  const dot=owner?options.store.get<Dot>('dots',owner.dotId):undefined;
  const root=dot&&(dot.rootThreadId===threadId||task?.source==='chat'||task?.source==='channel');
  if(root&&(request.method==='thread/read'||request.method==='thread/resume')&&result&&typeof result==='object'){
    const data=result as {thread?:{id?:string;[key:string]:unknown};[key:string]:unknown};
    if(data.thread?.id===threadId)return {handled:true,result:{...data,thread:{...data.thread,threadSource:'aeon',name:dot.name}}};
  }
  return {handled:true,result};
}
