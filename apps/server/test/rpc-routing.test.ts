import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../src/storage.js';
import { OrbitRuntime } from '../src/runtime/index.js';
import { listRecordedRemoteThreadOwners, routeNativeRpc, REMOTE_THREAD_RPC_METHODS, type RpcWorkerExecutor } from '../src/rpc-routing.js';
import type { Task } from '@dots/contracts';

function fixture() {
  const store=new SqliteStore(':memory:');const runtime=new OrbitRuntime(store,{async run(){throw new Error('Not executed in RPC routing tests');}});const dot=runtime.createDot({name:'Routing'});
  const add=(threadId:string|null,computerId:string|null,updatedAt='2026-10-01T10:00:00.000Z')=>{const task=runtime.createTask({dotId:dot.id,input:'Recorded actual execution',computerId});return store.put<Task>('tasks',{...task,threadId,status:'completed',result:'actual result',createdAt:updatedAt,updatedAt});};
  return {store,runtime,dot,add};
}
test('every whitelisted method dispatches to the computer that actually owns the persisted thread',async()=>{
  const {store,add}=fixture();add('worker-thread','computer-a');const calls:any[]=[];
  const actual={thread:{id:'worker-thread',turns:[{id:'actual-turn',items:[{type:'agentMessage',text:'Actual worker history'}]}]}};
  const workers:RpcWorkerExecutor={async execute(...args){calls.push(args);return actual;}};const controller=new AbortController();
  try {
    for(const method of REMOTE_THREAD_RPC_METHODS) {
      const params={threadId:'worker-thread',includeTurns:true,turnId:'actual-turn'};
      const result=await routeNativeRpc({method,params},{store,workers},controller.signal);assert.deepEqual(result,{handled:true,result:actual});
      const call=calls.at(-1);assert.equal(call[0],'computer-a');assert.equal(call[1],'rpc');assert.deepEqual(call[2],{request:{method,params}});assert.equal(call[3],undefined);assert.equal(call[4],controller.signal);
    }
    assert.equal(calls.length,REMOTE_THREAD_RPC_METHODS.length);
  } finally {store.close();}
});
test('initialize, thread/list, turn/start and unknown methods do not bypass runtime admission',async()=>{
  const {store,add}=fixture();add('worker-thread','computer-a');let calls=0;const workers:RpcWorkerExecutor={async execute(){calls++;throw new Error('Must not dispatch');}};
  try {for(const method of ['initialize','initialized','thread/list','turn/start','turn/steer','thread/delete','thread/metadata/update','unknown'])assert.deepEqual(await routeNativeRpc({method,params:{threadId:'worker-thread'}},{store,workers}),{handled:false});assert.equal(calls,0);}finally{store.close();}
});
test('latest consistent ownership wins; a central owner is not overridden by old worker records or computer selection',async()=>{
  const {store,runtime,dot,add}=fixture();add('same-thread','old-computer','2026-10-01T10:00:00.000Z');add('same-thread','new-computer','2026-10-01T11:00:00.000Z');add('central-thread',null);add('became-central','old-computer','2026-10-01T10:00:00.000Z');add('became-central',null,'2026-10-01T12:00:00.000Z');
  runtime.updateDot(dot.id,{computerId:'selected-computer'});store.put('dots',{...runtime.getDot(dot.id),rootThreadId:'central-thread'});
  const calls:any[]=[];const workers:RpcWorkerExecutor={async execute(computerId,kind,payload){calls.push({computerId,kind,payload});return {id:'actual'};}};
  try {
    assert.equal((await routeNativeRpc({method:'thread/read',params:{threadId:'same-thread'}},{store,workers})).handled,true);assert.equal(calls[0].computerId,'new-computer');
    for(const threadId of ['central-thread','became-central','not-recorded'])assert.deepEqual(await routeNativeRpc({method:'thread/read',params:{threadId}},{store,workers,resolveRootComputer:()=>threadId==='not-recorded'?undefined:'selected-computer'}),{handled:false});
    assert.equal(calls.length,1);assert.deepEqual(listRecordedRemoteThreadOwners(store).map(owner=>[owner.threadId,owner.computerId]),[['same-thread','new-computer']]);
  } finally {store.close();}
});
test('root alias routes only via an explicit proven mapping, and conflicting equally recent hosts fail closed',async()=>{
  const {store,add}=fixture();const calls:any[]=[];const workers:RpcWorkerExecutor={async execute(...args){calls.push(args);return {thread:{id:'actual-root'}};}};
  try {
    assert.equal((await routeNativeRpc({method:'thread/read',params:{threadId:'root-alias'}},{store,workers,resolveRootComputer:id=>id==='root-alias'?'root-worker':null})).handled,true);assert.equal(calls[0][0],'root-worker');
    add('conflicting','worker-a');add('conflicting','worker-b');await assert.rejects(routeNativeRpc({method:'thread/read',params:{threadId:'conflicting'}},{store,workers}),/conflicting execution computers/);assert.equal(calls.length,1);
  } finally {store.close();}
});
test('native socket AbortSignal cancels a real pending worker dispatch and worker failures never fall back centrally',async()=>{
  const {store,add}=fixture();add('thread-abort','worker-a');let capturedSignal:AbortSignal|undefined;let dispatched=0;
  const workers:RpcWorkerExecutor={async execute(computerId,kind,payload,hooks,signal){dispatched++;capturedSignal=signal;return new Promise((resolve,reject)=>{signal?.addEventListener('abort',()=>reject(signal.reason),{once:true});});}};
  try {
    const controller=new AbortController();const pending=routeNativeRpc({method:'thread/read',params:{threadId:'thread-abort'}},{store,workers},controller.signal);controller.abort(new Error('Native client disconnected'));await assert.rejects(pending,/Native client disconnected/);assert.equal(capturedSignal,controller.signal);assert.equal(dispatched,1);
    await assert.rejects(routeNativeRpc({method:'thread/read',params:{threadId:'thread-abort'}},{store,workers},controller.signal),/Native client disconnected/);assert.equal(dispatched,1);
    const offline:RpcWorkerExecutor={async execute(){throw Object.assign(new Error('Computer is offline'),{statusCode:409});}};await assert.rejects(routeNativeRpc({method:'thread/read',params:{threadId:'thread-abort'}},{store,workers:offline}),/Computer is offline/);
  } finally {store.close();}
});
test('missing thread ids pass through and dispatched params are insulated from adapter mutation',async()=>{
  const {store,add}=fixture();add('worker-thread','computer-a');let calls=0;const workers:RpcWorkerExecutor={async execute(computerId,kind,payload){calls++;((payload.request as any).params.nested).changed=true;return {actual:true};}};
  try {
    for(const params of [undefined,{}, {threadId:''},{threadId:25}])assert.deepEqual(await routeNativeRpc({method:'thread/read',params:params as any},{store,workers}),{handled:false});assert.equal(calls,0);
    const params={threadId:'worker-thread',nested:{changed:false}};await routeNativeRpc({method:'thread/read',params},{store,workers});assert.equal(params.nested.changed,false);
  } finally {store.close();}
});
