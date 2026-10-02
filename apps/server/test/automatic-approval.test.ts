import test from 'node:test';
import assert from 'node:assert/strict';
import {OrbitRuntime} from '../src/runtime/index.js';
import {SqliteStore} from '../src/storage.js';
import type {TaskRunner} from '@dots/contracts';
const wait=async(check:()=>boolean)=>{const end=Date.now()+3000;while(!check()){if(Date.now()>end)throw Error('Runtime timeout');await new Promise(r=>setTimeout(r,5));}};
const command={kind:'item/commandExecution/requestApproval',title:'Read project directory',detail:'read only',request:{command:'list'}};
test('automatic execution permission completes a real runtime task and leaves an audit record without waiting',async()=>{
 const store=new SqliteStore(':memory:');let decisions:boolean[]=[];
 const runner:TaskRunner={run:async(input,hooks)=>{for(const kind of [command.kind,'item/fileChange/requestApproval','item/permissions/requestApproval'])decisions.push(await hooks.onApproval({...command,kind}));return {text:'done',threadId:'auto-thread',turnId:'auto-turn'};}};
 const runtime=new OrbitRuntime(store,runner,{settings:()=>({autoApproveExecution:true})});const dot=runtime.createDot({name:'Auto'}),task=runtime.createTask({dotId:dot.id,input:'work'});
 try{runtime.start();await wait(()=>runtime.getTask(task.id).status==='completed');assert.deepEqual(decisions,[true,true,true]);assert(runtime.listApprovals().every(a=>a.status==='approved'));assert.equal(runtime.listActivity().filter(a=>a.type==='approval.automatic').length,3);}finally{await runtime.stop();store.close();}
});
test('enabling full access releases an existing command wait and allows execution permissions, proactive work stays read-only',async()=>{
 const store=new SqliteStore(':memory:');let enabled=false;
 const runner:TaskRunner={run:async(input,hooks)=>{assert.equal(await hooks.onApproval(command),true);const allowed=await hooks.onApproval({kind:'external_send',title:'Send message',detail:'',request:{}});return {text:String(allowed),threadId:'t',turnId:'v'};}};
 const runtime=new OrbitRuntime(store,runner,{settings:()=>({autoApproveExecution:enabled})});const dot=runtime.createDot({name:'Switch'}),task=runtime.createTask({dotId:dot.id,input:'work'});
 try{runtime.start();await wait(()=>runtime.getTask(task.id).status==='waiting_approval');enabled=true;runtime.applyExecutionApprovalSetting();await wait(()=>runtime.getTask(task.id).status==='completed');assert.equal(runtime.listApprovals().find(a=>a.kind===command.kind)?.status,'approved');assert.equal(runtime.listApprovals().find(a=>a.kind==='external_send')?.status,'approved');assert.equal(runtime.getTask(task.id).result,'true');const proactive=runtime.createTask({dotId:dot.id,input:'research',source:'proactive'});assert.equal(await runtime.requestApproval(proactive.id,command),false);}finally{await runtime.stop();store.close();}
});
test('automatic execution mode still waits for actual question answers',async()=>{
 const store=new SqliteStore(':memory:');const runner:TaskRunner={run:async(input,hooks)=>{const result=await hooks.onUserInput!({kind:'user_input',title:'Which project?',detail:'',request:{questions:[{id:'project'}]}});return {text:JSON.stringify(result),threadId:'q',turnId:'qv'};}};
 const runtime=new OrbitRuntime(store,runner,{settings:()=>({autoApproveExecution:true})});const dot=runtime.createDot({name:'Questions'}),task=runtime.createTask({dotId:dot.id,input:'work'});
 try{runtime.start();await wait(()=>runtime.listApprovals().some(a=>a.kind==='user_input'));assert.equal(runtime.getTask(task.id).status,'waiting_approval');runtime.resolveApproval(runtime.listApprovals()[0].id,{approved:true,resolution:{answers:{project:{answers:['Project A']}}}});await wait(()=>runtime.getTask(task.id).status==='completed');assert.match(runtime.getTask(task.id).result!,/Project A/);}finally{await runtime.stop();store.close();}
});
