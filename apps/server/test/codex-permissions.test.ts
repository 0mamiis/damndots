import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocketServer,WebSocket} from 'ws';
import {once} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {MainCodex} from '../src/main-codex.js';
import {SqliteStore} from '../src/storage.js';

async function fixture(fullAccess:boolean,onApproval?:any){
 const folder=await mkdtemp(join(tmpdir(),'dots-permissions-')),tokenFile=join(folder,'token.txt');
 await writeFile(tokenFile,'fixture-only-loopback-test-token');
 const ws=new WebSocketServer({host:'127.0.0.1',port:0});await once(ws,'listening');
 const frames:any[]=[];let decision:any;let socket:WebSocket|undefined;let state='idle';let turnId='turn';
 const thread=()=>({id:'target',cwd:folder,name:'Agent',status:{type:state},turns:state==='active'?[{id:turnId,status:'inProgress',items:[]}]:[]});
 ws.on('connection',s=>{socket=s;s.on('message',bytes=>{
  const m=JSON.parse(String(bytes));frames.push(m);
  if(m.id===77){decision=m.result;return;}
  let result:any={};
  if(m.method==='config/read')result={config:{projects:{[folder]:{trust_level:'trusted'}}}};
  if(m.method==='thread/start'||m.method==='thread/resume')result={thread:thread()};
  if(m.method==='thread/read')result={thread:thread()};
  if(m.method==='turn/start'){state='active';result={turn:{id:turnId,status:'inProgress'}};}
  if(m.id!==undefined&&m.method)s.send(JSON.stringify({id:m.id,result}));
 });});
 const store=new SqliteStore(':memory:'),codex=new MainCodex({enabled:true,tokenFile,url:'ws://127.0.0.1:'+(ws.address() as any).port},store);
 const execution:{fullAccess:boolean;onApproval?:any;onUserInput?:any}={fullAccess,onApproval};
 return {folder,frames,store,codex,execution,get decision(){return decision;},setState(s:string){state=s;},approve(){socket!.send(JSON.stringify({id:77,method:'item/commandExecution/requestApproval',params:{threadId:'target',turnId,command:'outside-workspace-command'}}));},ask(){socket!.send(JSON.stringify({id:77,method:'item/tool/requestUserInput',params:{threadId:'target',turnId,questions:[{id:'choice',question:'Choose'}]}}));},async close(){codex.close();for(const s of ws.clients)s.terminate();await new Promise<void>(r=>ws.close(()=>r()));store.close();await rm(folder,{recursive:true,force:true});}};
}
async function eventually(fn:()=>boolean){for(let i=0;i<100&&!fn();i++)await new Promise(r=>setTimeout(r,5));assert.equal(fn(),true);}

test('new Codex chats obey restricted mode and denied approval after the start tool returns',async()=>{
 let requested=0;const f=await fixture(false,async()=>{requested++;return false;});
 try{
  await f.codex.call('codex_thread_start',{cwd:f.folder,message:'work',waitSeconds:0},undefined,undefined,f.execution);
  const start=f.frames.find(m=>m.method==='thread/start'),turn=f.frames.find(m=>m.method==='turn/start');
  assert.equal(start.params.sandbox,'workspace-write');assert.equal(start.params.approvalPolicy,'on-request');
  assert.equal(turn.params.sandboxPolicy.type,'workspaceWrite');assert.equal(turn.params.sandboxPolicy.networkAccess,false);
  f.approve();await eventually(()=>!!f.decision);
  assert.equal(requested,1);assert.equal(f.decision.decision,'decline');
 }finally{await f.close();}
});
test('full access is granted only by explicit execution context',async()=>{
 let requested=0;const f=await fixture(true,async()=>{requested++;return false;});
 try{
  await f.codex.call('codex_thread_start',{cwd:f.folder,message:'work',waitSeconds:0},undefined,undefined,f.execution);
  assert.equal(f.frames.find(m=>m.method==='thread/start').params.sandbox,'danger-full-access');
  assert.equal(f.frames.find(m=>m.method==='turn/start').params.sandboxPolicy.type,'dangerFullAccess');
  f.approve();await eventually(()=>!!f.decision);assert.equal(f.decision.decision,'accept');assert.equal(requested,0);
 }finally{await f.close();}
});
test('restricted followups downgrade Dot-owned chats and refuse to steer an already active chat',async()=>{
 const f=await fixture(false);
 try{
  f.store.put('main_codex_threads',{id:'target'});f.setState('notLoaded');
  await f.codex.call('codex_thread_send',{threadId:'target',message:'followup',waitSeconds:0},undefined,undefined,f.execution);
  assert.equal(f.frames.find(m=>m.method==='thread/resume').params.sandbox,'workspace-write');
  assert.equal(f.frames.find(m=>m.method==='turn/start').params.sandboxPolicy.type,'workspaceWrite');
  await assert.rejects(f.codex.call('codex_thread_send',{threadId:'target',message:'steer',waitSeconds:0},undefined,undefined,f.execution),/Restricted execution/);
  assert.equal(f.frames.some(m=>m.method==='turn/steer'),false);
 }finally{await f.close();}
});

test('a background child question forwards the real user answer instead of fabricating one',async()=>{
 const f=await fixture(false);const answer={answers:{choice:{answers:['real answer']}}};let requested=0;
 f.execution.onUserInput=async()=>{requested++;return answer;};
 try{
  await f.codex.call('codex_thread_start',{cwd:f.folder,message:'work',waitSeconds:0},undefined,undefined,f.execution);
  f.ask();await eventually(()=>!!f.decision);assert.equal(requested,1);assert.deepEqual(f.decision,answer);
 }finally{await f.close();}
});
