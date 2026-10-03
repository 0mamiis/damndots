import test from 'node:test';
import assert from 'node:assert/strict';
import {DotTools} from '../src/tools.js';
import {SqliteStore} from '../src/storage.js';

test('restricted local dispatch requires explicit approval before any desktop request',async()=>{
 const store=new SqliteStore(':memory:');let dispatched=0,requested=0;
 store.put('dots',{id:'actual-dot',name:'Assistant',rootThreadId:'actual-root'});
 const runtime:any={requestApproval:async()=>{requested++;return false;}};
 const tools=new DotTools(()=>runtime,()=>({} as any),{} as any,store);
 (tools as any).localCodex={call:async()=>{dispatched++;return {ok:true};}};
 const input:any={dot:{id:'actual-dot'},task:{id:'task',source:'chat'},fullAccess:false};
 try{
  await assert.rejects(tools.call('local_codex_thread_send',{threadId:'target',message:'message'},input,new AbortController().signal),/not approved/);
  assert.equal(requested,1);assert.equal(dispatched,0);
  runtime.requestApproval=async()=>true;
  assert.deepEqual(await tools.call('local_codex_thread_send',{threadId:'target',message:'message'},input,new AbortController().signal),{ok:true});
  assert.equal(dispatched,1);
 }finally{tools.close();store.close();}
});
