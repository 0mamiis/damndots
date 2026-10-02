import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../src/app.js';
import { SqliteStore } from '../src/storage.js';
import type { RunInput, RunnerHooks, TaskRunner } from '@dots/contracts';
const wait=async(fn:()=>boolean)=>{for(let i=0;i<200&&!fn();i++)await new Promise(r=>setTimeout(r,5));assert.ok(fn());};
async function fixture(runner:TaskRunner){const dir=await mkdtemp(join(tmpdir(),'dots-api-')),store=new SqliteStore(':memory:');const config={host:'127.0.0.1',port:0,dataDir:dir,adminKey:'private-test-key',signingKey:Buffer.alloc(32,1),modelBaseUrl:'http://localhost:10100/v1',modelApiKey:'',appServerUrl:'ws://localhost:9912',model:null,reasoningEffort:'high',serviceTier:null,workerOnlineMs:45000};const services=await buildServer({config,store,runner});await services.app.ready();const login=await services.app.inject({method:'POST',url:'/api/v1/session',payload:{token:config.adminKey}}),access=login.json().accessToken;const request=(method:any,url:string,payload?:any,token=access)=>services.app.inject({method,url:'/api/v1'+url,headers:{authorization:'Bearer '+token},...payload!==undefined?{payload}:{}});return {...services,dir,request,cleanup:async()=>{await services.app.close();await rm(dir,{recursive:true,force:true});}};}
test('Dots native bootstrap keeps the app navigation rail alongside Dot features',async()=>{
 const f=await fixture({run:async()=>{throw new Error('No task expected');}});try{
  const token=f.auth.nativeTokens('navigation-client').access_token;
  const response=await f.app.inject({method:'POST',url:'/backend-api/wham/statsig/bootstrap',headers:{authorization:'Bearer '+token},payload:{stable_id:'navigation-test',app_version:'26.928.2636',build_flavor:'prod'}});
  assert.equal(response.statusCode,200);
  const payload=JSON.parse(response.json().statsigPayload);
  assert.equal(payload.feature_gates['3085093835'].value,true);
  assert.equal(payload.feature_gates['775990392'].value,true);
  assert.equal(payload.feature_gates['970190263'].value,true);
  assert.equal(payload.hash_used,'djb2');
 }finally{await f.cleanup();}
});
test('automatic command approval is an explicit persistent owner setting and applies to runtime requests',async()=>{
 const f=await fixture({run:async(input,hooks)=>{const ok=await hooks.onApproval({kind:'item/commandExecution/requestApproval',title:'Read directory',detail:'',request:{}});return {text:String(ok),threadId:'auto-api',turnId:'turn-auto'};}});
 try{
  assert.equal((await f.request('GET','/settings')).json().autoApproveExecution,true);
  const saved=await f.request('PATCH','/settings',{autoApproveExecution:true});assert.equal(saved.statusCode,200);assert.equal(saved.json().autoApproveExecution,true);assert.equal(f.store.get<any>('settings','owner')!.autoApproveExecution,true);
  const dot=(await f.request('POST','/dots',{name:'Auto'})).json();f.runtime.start();const submitted=(await f.request('POST','/dots/'+dot.id+'/messages',{text:'Read'})).json();await wait(()=>f.runtime.getTask(submitted.task.id).status==='completed');assert.equal(f.runtime.getTask(submitted.task.id).result,'true');assert.equal(f.runtime.listApprovals()[0].status,'approved');
 }finally{await f.cleanup();}
});
test('dashboard defaults stay inherited and archived test profiles do not appear in the native Dot list',async()=>{
 const f=await fixture({run:async()=>{throw new Error('No task expected');}});try{
  await f.request('PATCH','/settings',{model:'dashboard-first',reasoningEffort:'high',serviceTier:null});
  const dot=(await f.request('POST','/dots',{name:'Genius'})).json();assert.equal(dot.model,null);assert.equal(dot.reasoningEffort,null);
  const test=(await f.request('POST','/dots',{name:'Acceptance',model:'explicit-test'})).json();
  f.store.put('native_hidden_dots',{id:test.id,reason:'acceptance-test'});
  const token=f.auth.nativeTokens('list-client').access_token;
  const list=await f.app.inject({method:'GET',url:'/backend-api/tbo',headers:{authorization:'Bearer '+token}});
  assert.equal(list.statusCode,200);assert.deepEqual(list.json().items.map((d:any)=>d.id),[dot.id]);
  const first=(await f.request('POST','/dots/'+dot.id+'/messages',{text:'First'})).json();assert.equal(first.task.model,'dashboard-first');
  await f.request('PATCH','/settings',{model:'dashboard-second',reasoningEffort:'low'});
  const second=(await f.request('POST','/dots/'+dot.id+'/messages',{text:'Second'})).json();assert.equal(second.task.model,'dashboard-second');assert.equal(second.task.reasoningEffort,'low');
 }finally{await f.cleanup();}
});
test('failed native creation leaves no partial profile or stale primary selection',async()=>{
 const f=await fixture({run:async()=>{throw new Error('No task expected');}});try{
  await f.request('PATCH','/settings',{appServerUrl:'ws://127.0.0.1:0'});
  const token=f.auth.nativeTokens('create-client').access_token;
  const r=await f.app.inject({method:'POST',url:'/backend-api/tbo',headers:{authorization:'Bearer '+token},payload:{display_name:'Incomplete',create_additional:false}});
  assert.equal(r.statusCode,500);assert.equal(f.runtime.listDots().length,0);assert.equal(f.store.get('native_meta','primary'),undefined);
 }finally{await f.cleanup();}
});
test('admin/native/worker/file roles stay separate; enrollment is single use and revoke invalidates worker',async()=>{
 const f=await fixture({run:async()=>{throw new Error('No task expected');}});try{
  assert.equal((await f.app.inject('/api/v1/overview')).statusCode,401);
  const enroll=(await f.request('POST','/computers/enrollment',{})).json();
  const first=await f.app.inject({method:'POST',url:'/worker/register',payload:{token:enroll.token,name:'controlled worker',platform:'test',roots:[f.dir],capabilities:['codex','browser','filesystem']}});assert.equal(first.statusCode,200);
  const worker=first.json();assert.equal((await f.app.inject({method:'POST',url:'/worker/register',payload:{token:enroll.token,name:'duplicate',platform:'test',roots:[],capabilities:[]}})).statusCode,401);
  assert.equal((await f.request('GET','/overview',undefined,worker.token)).statusCode,401);
  const native=f.auth.nativeTokens('test-client').access_token;assert.equal((await f.request('GET','/overview',undefined,native)).statusCode,401);
  const file=f.auth.issue('file','test-client',300,{fileId:'one'});assert.equal((await f.app.inject({url:'/backend-api/tbo',headers:{authorization:'Bearer '+file}})).statusCode,401);
  await f.request('DELETE','/computers/'+worker.computerId);assert.equal((await f.app.inject({method:'POST',url:'/worker/heartbeat',payload:{},headers:{authorization:'Bearer '+worker.token}})).statusCode,401);
 }finally{await f.cleanup();}
});
test('HTTP message requestId survives duplication, durable queues pause, and attachment path cannot be forged',async()=>{
 let runs=0;const f=await fixture({run:async(input,hooks)=>{runs++;hooks.onThread('thread-real');hooks.onTurn('turn-real');return {text:input.task.input,threadId:'thread-real',turnId:'turn-real'};}});try{
  const dot=(await f.request('POST','/dots',{name:'Actual API dot'})).json();await f.request('POST','/dots/'+dot.id+'/pause');f.runtime.start();
  const body={text:'Queued actual API message',requestId:'repeat'};const a=(await f.request('POST','/dots/'+dot.id+'/messages',body)).json(),b=(await f.request('POST','/dots/'+dot.id+'/messages',body)).json();assert.equal(a.task.id,b.task.id);assert.equal(a.task.status,'paused');assert.equal(runs,0);
  const foreign=await f.blobs.put(Buffer.from('local'), 'secret.txt','text/plain','other-dot');
  const rejected=await f.request('POST','/dots/'+dot.id+'/messages',{text:'Read file',attachments:[{...foreign,path:join(f.dir,'outside')}]});assert.equal(rejected.statusCode,403);
  const correct=await f.blobs.put(Buffer.from('allowed'), 'file.txt','text/plain',dot.id);
  const accepted=await f.request('POST','/dots/'+dot.id+'/messages',{text:'Queued attachment',attachments:[{...correct,path:'C:/Windows/not-authorized',name:'forged'}]});assert.equal(accepted.statusCode,200);assert.equal(accepted.json().task.attachments[0].path,correct.path);assert.equal(accepted.json().task.attachments[0].name,'file.txt');
  await f.request('POST','/dots/'+dot.id+'/resume');await wait(()=>f.runtime.listTasks().every(t=>t.status==='completed'));assert.equal(runs,2);
 }finally{await f.cleanup();}
});
test('actual question answers and outputs flow through authenticated HTTP routes',async()=>{
 let answer:unknown;let file:string;const f=await fixture({run:async(input,hooks)=>{answer=await hooks.onUserInput!({kind:'user_input',title:'Choose format',detail:'Format',request:{questions:[{id:'format',question:'Format?',options:[{label:'text'}]}]}});file=join(f.dir,'workspaces','actual.txt');await writeFile(file,'real artifact bytes');hooks.onOutput({path:file,name:'actual.txt',mimeType:'text/plain',size:19,computerId:null});return {text:JSON.stringify(answer),threadId:'question-thread',turnId:'question-turn'};}});try{
  const dot=(await f.request('POST','/dots',{name:'Questions'})).json();const task=(await f.request('POST','/tasks',{dotId:dot.id,input:'Answer and write file'})).json();f.runtime.start();await wait(()=>f.runtime.listApprovals().length===1);const a=f.runtime.listApprovals()[0];
  assert.equal((await f.request('POST','/approvals/'+a.id+'/resolve',{approved:true})).statusCode,400);
  assert.equal((await f.request('POST','/approvals/'+a.id+'/resolve',{approved:true,resolution:{answers:{format:{answers:['text']}}}})).statusCode,200);await wait(()=>f.runtime.getTask(task.id).status==='completed');assert.deepEqual(answer,{answers:{format:{answers:['text']}}});
  const output=(await f.request('GET','/outputs?taskId='+task.id)).json().items[0];const content=await f.request('GET','/outputs/'+output.id+'/content');assert.equal(content.statusCode,200);assert.equal(content.body,'real artifact bytes');
 }finally{await f.cleanup();}
});
