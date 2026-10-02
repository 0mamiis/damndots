import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../src/storage.js';
import { OrbitRuntime } from '../src/runtime/index.js';
import type { RunInput, RunResult, RunnerHooks, TaskRunner } from '@dots/contracts';
import { nextRecurrence } from '../src/runtime/recurrence.js';

async function until(check:()=>boolean):Promise<void> {
  const deadline=Date.now()+3000;
  while(!check()) {if(Date.now()>deadline) throw new Error('Timed out waiting for runtime state');await new Promise(resolve=>setTimeout(resolve,2));}
}
class GateRunner implements TaskRunner {
  calls:Array<{input:RunInput;hooks:RunnerHooks;signal:AbortSignal;resolve:(value:RunResult)=>void}>=[];
  run(input:RunInput,hooks:RunnerHooks,signal:AbortSignal):Promise<RunResult> {
    hooks.onThread(input.task.threadId??`thread-${input.task.id}`);hooks.onTurn(`turn-${input.task.id}`);
    return new Promise((resolve,reject)=>{
      this.calls.push({input,hooks,signal,resolve});
      signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
      if(signal.aborted) reject(signal.reason);
    });
  }
  complete(index:number,text='done'):void {const c=this.calls[index];c.resolve({text,threadId:c.input.task.threadId??`thread-${c.input.task.id}`,turnId:`turn-${c.input.task.id}`});}
}
test('durable request deduplication keeps queued messages and enforces one turn per room',async()=>{
  const store=new SqliteStore(':memory:');const runner=new GateRunner();const runtime=new OrbitRuntime(store,runner,{maxParallelTasks:2});
  const a=runtime.createDot({name:'A'});const b=runtime.createDot({name:'B'});
  const first=runtime.submitMessage(a.id,{text:'first',requestId:'request-1'});
  const duplicate=runtime.submitMessage(a.id,{text:'changed on retransmit',requestId:'request-1'});
  const second=runtime.submitMessage(a.id,{text:'second',requestId:'request-2'});
  runtime.submitMessage(b.id,{text:'parallel room'});
  assert.equal(first.task.id,duplicate.task.id);assert.equal(first.message.id,duplicate.message.id);
  assert.equal(runtime.listMessages(a.id).length,2);
  runtime.start();await until(()=>runner.calls.length===2);
  assert.deepEqual(runner.calls.map(c=>c.input.task.input),['first','parallel room']);
  assert.equal(runtime.getTask(second.task.id).status,'queued');
  runner.complete(0);await until(()=>runner.calls.length===3);
  assert.equal(runner.calls[2].input.task.input,'second');
  assert.equal(runner.calls[2].input.task.threadId,`thread-${first.task.id}`);
  runner.complete(1);runner.complete(2);await until(()=>runtime.listTasks().every(t=>t.status==='completed'));
  assert.equal(runtime.listMessages(a.id).filter(m=>m.role==='assistant').length,2);
  await runtime.stop();store.close();
});
test('pause aborts actual running work; resume reuses thread and cancellation cascades to children',async()=>{
  const store=new SqliteStore(':memory:');const runner=new GateRunner();const runtime=new OrbitRuntime(store,runner);
  const dot=runtime.createDot({name:'Dot'});const parent=runtime.createTask({dotId:dot.id,input:'parent'});const child=runtime.delegateTask(parent.id,{input:'child'});
  runtime.start();await until(()=>runner.calls.length===2);
  assert.equal(runtime.getTask(parent.id).status,'running');assert.equal(runtime.getTask(child.id).status,'running');assert.equal(runtime.getDot(dot.id).rootThreadId,null);
  runtime.pauseDot(dot.id);assert.equal(runner.calls[0].signal.aborted,true);assert.equal(runner.calls[1].signal.aborted,true);assert.equal(runtime.getTask(parent.id).status,'paused');assert.equal(runtime.getTask(child.id).status,'paused');
  runtime.resumeDot(dot.id);await until(()=>runner.calls.length===4);
  assert.equal(runner.calls[2].input.task.threadId,`thread-${parent.id}`);
  runtime.cancelTask(parent.id);assert.equal(runner.calls[2].signal.aborted,true);assert.equal(runner.calls[3].signal.aborted,true);assert.equal(runtime.getTask(child.id).status,'cancelled');
  await until(()=>runtime.getTask(parent.id).status==='cancelled');await runtime.stop();store.close();
});
test('SQLite restart preserves dedupe, memory, events and resumes interrupted work',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'dots-runtime-'));const filename=join(folder,'store.db');
  let store=new SqliteStore(filename);const runner=new GateRunner();let runtime=new OrbitRuntime(store,runner);
  const dot=runtime.createDot({name:'Persistent'});const submission=runtime.submitMessage(dot.id,{text:'continue',requestId:'stable'});
  const memory=runtime.createMemory({dotId:dot.id,title:'Preference',content:'Use actual data',tags:['preference']});
  runtime.start();await until(()=>runner.calls.length===1);const eventId=runtime.replay().at(-1)!.id;
  await runtime.stop();assert.equal(runtime.getTask(submission.task.id).status,'interrupted');store.close();
  store=new SqliteStore(filename);const nextRunner=new GateRunner();runtime=new OrbitRuntime(store,nextRunner);
  assert.equal(runtime.submitMessage(dot.id,{text:'continue',requestId:'stable'}).task.id,submission.task.id);
  runtime.start();await until(()=>nextRunner.calls.length===1);
  assert.equal(nextRunner.calls[0].input.memories[0].id,memory.id);assert.equal(nextRunner.calls[0].input.task.threadId,`thread-${submission.task.id}`);
  nextRunner.complete(0);await until(()=>runtime.getTask(submission.task.id).status==='completed');
  assert.ok(runtime.replay(eventId).length>0);assert.ok(runtime.replay(eventId).every(event=>event.id>eventId));
  await runtime.stop();store.close();rmSync(folder,{recursive:true,force:true});
});
test('approval waits for a decision, denied approvals remain denied, pause expires waits',async()=>{
  const store=new SqliteStore(':memory:');let hooks:RunnerHooks|undefined;
  const runner:TaskRunner={async run(input,runHooks,signal){hooks=runHooks;const approved=await runHooks.onApproval({kind:'send',title:'Send mail',detail:'Exact recipient',request:{recipient:'test@example.invalid'}});if(signal.aborted) throw signal.reason;return {text:approved?'sent':'declined',threadId:'approval-thread',turnId:'approval-turn'};}};
  const runtime=new OrbitRuntime(store,runner);const dot=runtime.createDot({name:'Approval'});const task=runtime.createTask({dotId:dot.id,input:'send'});
  runtime.start();await until(()=>runtime.listApprovals().length===1);assert.ok(hooks);assert.equal(runtime.getTask(task.id).status,'waiting_approval');
  const approval=runtime.listApprovals()[0];runtime.resolveApproval(approval.id,false);await until(()=>runtime.getTask(task.id).status==='completed');assert.equal(runtime.getTask(task.id).result,'declined');
  assert.throws(()=>runtime.resolveApproval(approval.id,true),/already been resolved/);
  const next=runtime.createTask({dotId:dot.id,input:'send again'});await until(()=>runtime.listApprovals().length===2);
  runtime.pauseDot(dot.id);await until(()=>runtime.listApprovals()[1].status==='expired');assert.equal(runtime.getTask(next.id).status,'paused');
  await runtime.stop();store.close();
});
test('interactive questions require real answers, persist resolution and abort pending input on pause',async()=>{
  const store=new SqliteStore(':memory:');let answered:Record<string,unknown>|null|undefined;
  const runner:TaskRunner={async run(input,hooks,signal){answered=await hooks.onUserInput!({kind:'user_input',title:'Choose',detail:'',request:{questions:[{id:'choice',question:'Which option?',options:[{label:'A',description:'First'},{label:'B',description:'Second'}]}]}});signal.throwIfAborted();return {text:JSON.stringify(answered),threadId:'input-thread',turnId:'input-turn'};}};
  const runtime=new OrbitRuntime(store,runner);const dot=runtime.createDot({name:'Questions'});const task=runtime.createTask({dotId:dot.id,input:'ask'});runtime.start();await until(()=>runtime.listApprovals().length===1);
  const approval=runtime.listApprovals()[0];assert.throws(()=>runtime.resolveApproval(approval.id,true),/answers are required/);assert.equal(runtime.listApprovals()[0].status,'pending');
  assert.throws(()=>runtime.resolveApproval(approval.id,{approved:true,resolution:{answers:{choice:{answers:[]}}}}),/Answer required/);
  const resolution={answers:{choice:{answers:['B']}}};runtime.resolveApproval(approval.id,{approved:true,resolution});await until(()=>runtime.getTask(task.id).status==='completed');assert.deepEqual(answered,resolution);assert.deepEqual(runtime.listApprovals()[0].resolution,resolution);
  runtime.createTask({dotId:dot.id,input:'ask again'});await until(()=>runtime.listApprovals().length===2);runtime.pauseDot(dot.id);await until(()=>runtime.listApprovals()[1].status==='expired');assert.equal(answered,null);
  await runtime.stop();store.close();
});
test('MCP form validates real nested content, constraints and standard formats before resolving',async()=>{
  const store=new SqliteStore(':memory:');let content:Record<string,unknown>|null|undefined;
  const requestedSchema={$schema:'https://json-schema.org/draft/2020-12/schema',type:'object',required:['contact','count'],additionalProperties:false,properties:{contact:{type:'object',required:['email'],properties:{email:{type:'string',format:'email'}}},count:{type:'integer',minimum:1,maximum:10}}};
  const runtime=new OrbitRuntime(store,{async run(input,hooks){content=await hooks.onUserInput!({kind:'form_input',title:'Form',detail:'Contact',request:{mode:'form',requestedSchema}});return {text:JSON.stringify(content),threadId:'form-thread',turnId:'form-turn'};}});const dot=runtime.createDot({name:'Form'});const task=runtime.createTask({dotId:dot.id,input:'ask form'});runtime.start();await until(()=>runtime.listApprovals().length===1);const approval=runtime.listApprovals()[0];assert.equal(approval.kind,'form_input');
  assert.throws(()=>runtime.resolveApproval(approval.id,true),/Structured form content/);
  assert.throws(()=>runtime.resolveApproval(approval.id,{approved:true,resolution:{content:{contact:{email:'not an email'},count:0}}}),/does not satisfy/);
  assert.equal(runtime.listApprovals()[0].status,'pending');const resolution={content:{contact:{email:'user@example.invalid'},count:3}};runtime.resolveApproval(approval.id,{approved:true,resolution});await until(()=>runtime.getTask(task.id).status==='completed');assert.deepEqual(content,resolution);assert.deepEqual(runtime.listApprovals()[0].resolution,resolution);await runtime.stop();store.close();
});
test('scheduler coalesces missed ticks, executes once only once, understands timezone cron and obeys proactive settings',async()=>{
  const store=new SqliteStore(':memory:');const runner=new GateRunner();let time=new Date('2026-09-30T00:00:00Z');let enabled=false;
  const runtime=new OrbitRuntime(store,runner,{clock:()=>time,settings:()=>({proactiveEnabled:enabled}),tickMs:60_000});const dot=runtime.createDot({name:'Schedules'});
  const interval=runtime.createSchedule({dotId:dot.id,title:'Every minute',prompt:'inspect',kind:'interval',intervalSeconds:60});
  const once=runtime.createSchedule({dotId:dot.id,title:'Once',prompt:'once',kind:'once',nextRunAt:'2026-09-30T00:00:10Z'});
  const cron=runtime.createSchedule({dotId:dot.id,title:'Daily Istanbul',prompt:'daily',kind:'cron',cron:'0 8 * * *',timezone:'Europe/Istanbul'});
  assert.equal(cron.nextRunAt,'2026-09-30T05:00:00.000Z');
  runtime.createSchedule({dotId:dot.id,title:'Proactive',prompt:'research',kind:'interval',intervalSeconds:60,proactive:true});
  runtime.start();time=new Date('2026-09-30T00:10:00Z');runtime.tick();runtime.tick();
  assert.equal(runtime.listTasks().length,2);assert.equal(runtime.listSchedules().find(s=>s.id===once.id)!.enabled,false);
  assert.equal(runtime.listSchedules().find(s=>s.id===interval.id)!.nextRunAt,'2026-09-30T00:11:00.000Z');
  enabled=true;runtime.tick();assert.equal(runtime.listTasks().length,3);const research=runtime.listTasks().find(t=>t.source==='proactive')!;
  assert.equal(await runtime.requestApproval(research.id,{kind:'write',title:'Write',detail:'',request:{}}),false);
  assert.throws(()=>runtime.delegateTask(research.id,{input:'mutate'}),/cannot delegate/);
  assert.throws(()=>runtime.createSchedule({dotId:dot.id,title:'Invalid',prompt:'bad',kind:'cron',cron:'this is invalid'}),/Invalid cron/);
  assert.throws(()=>runtime.createSchedule({dotId:dot.id,title:'Invalid timezone',prompt:'bad',kind:'interval',intervalSeconds:60,timezone:'Mars/Anywhere'}),/Invalid timezone/);
  await runtime.stop();store.close();
});
test('outputs and activities record hooks and failure has no invented assistant message',async()=>{
  const store=new SqliteStore(':memory:');const runner:TaskRunner={async run(input,hooks){hooks.onActivity('command','Actual command',{exitCode:0});hooks.onOutput({name:'real.txt',path:'/workspace/real.txt',size:4,mimeType:'text/plain',computerId:null});throw new Error('actual upstream failure');}};
  const runtime=new OrbitRuntime(store,runner);const dot=runtime.createDot({name:'Failure'});const task=runtime.createTask({dotId:dot.id,input:'fail'});
  runtime.start();await until(()=>runtime.getTask(task.id).status==='failed');assert.equal(runtime.getTask(task.id).error,'actual upstream failure');assert.equal(runtime.listMessages(dot.id).length,0);assert.equal(runtime.listOutputs({taskId:task.id}).length,1);assert.ok(runtime.listActivity({taskId:task.id}).some(a=>a.type==='command'));
  await runtime.stop();store.close();
});
test('remote task and switched delegation cwd belongs to the worker rather than server default',()=>{
  const store=new SqliteStore(':memory:');const runtime=new OrbitRuntime(store,new GateRunner(),{defaultCwd:'C:/server/workspace'});const dot=runtime.createDot({name:'Remote',computerId:'worker-one'});
  const remote=runtime.createTask({dotId:dot.id,input:'remote'});assert.equal(remote.cwd,null);assert.equal(remote.computerId,'worker-one');
  const local=runtime.createTask({dotId:dot.id,input:'local',computerId:null});assert.equal(local.cwd,'C:/server/workspace');
  const explicit=runtime.createTask({dotId:dot.id,input:'explicit',cwd:'D:/worker/workspace'});assert.equal(explicit.cwd,'D:/worker/workspace');
  const switched=runtime.delegateTask(local.id,{input:'remote child',computerId:'worker-two'});assert.equal(switched.cwd,null);assert.equal(switched.computerId,'worker-two');store.close();
});
test('native VEVENT RRULE and DTSTART-only schedules honor wall-clock timezone, missed runs and expiration',async()=>{
  const store=new SqliteStore(':memory:');let time=new Date('2026-10-01T00:00:00Z');const runtime=new OrbitRuntime(store,new GateRunner(),{clock:()=>time,tickMs:60_000});const dot=runtime.createDot({name:'RFC schedules'});
  const raw='BEGIN:VEVENT\nDTSTART;TZID=Europe/Istanbul:20261001T080000\nRRULE:FREQ=DAILY;COUNT=3\nEND:VEVENT';
  const daily=runtime.createSchedule({dotId:dot.id,title:'Native daily',prompt:'inspect',kind:'rrule',rrule:raw,timezone:'Europe/Istanbul'});assert.equal(daily.nextRunAt,'2026-10-01T05:00:00.000Z');assert.equal(daily.rrule,raw);
  const once=runtime.createSchedule({dotId:dot.id,title:'Native once',prompt:'inspect',kind:'rrule',rrule:'BEGIN:VEVENT\nDTSTART;TZID=Europe/Istanbul:20261001T070000\nEND:VEVENT',timezone:'Europe/Istanbul'});assert.equal(once.nextRunAt,'2026-10-01T04:00:00.000Z');
  runtime.start();time=new Date('2026-10-01T05:10:00Z');runtime.tick();runtime.tick();assert.equal(runtime.listTasks().length,2);assert.equal(runtime.listSchedules().find(s=>s.id===once.id)!.enabled,false);assert.equal(runtime.listSchedules().find(s=>s.id===once.id)!.nextRunAt,null);
  assert.equal(runtime.updateSchedule(once.id,{title:'Completed one-off is editable'}).title,'Completed one-off is editable');
  time=new Date('2026-10-02T05:10:00Z');runtime.tick();assert.equal(runtime.listTasks().length,3);assert.equal(runtime.listSchedules().find(s=>s.id===daily.id)!.nextRunAt,'2026-10-03T05:00:00.000Z');
  time=new Date('2026-10-05T00:00:00Z');runtime.tick();runtime.tick();assert.equal(runtime.listTasks().length,4);assert.equal(runtime.listSchedules().find(s=>s.id===daily.id)!.enabled,false);assert.equal(runtime.listSchedules().find(s=>s.id===daily.id)!.nextRunAt,null);
  assert.throws(()=>runtime.createSchedule({dotId:dot.id,title:'Invalid rule',prompt:'bad',kind:'rrule',rrule:'FREQ=INVALID',timezone:'UTC'}),/Invalid RRULE/);
  await runtime.stop();store.close();
});
test('RFC recurrence handles DST, UTC DTSTART, exclusions and anchored minute intervals without process TZ changes',()=>{
  const berlin='DTSTART;TZID=Europe/Berlin:20261024T080000\nRRULE:FREQ=DAILY;COUNT=4';
  assert.equal(nextRecurrence(berlin,'UTC','2026-10-01T00:00:00Z','2026-10-24T00:00:00Z'),'2026-10-24T06:00:00.000Z');
  assert.equal(nextRecurrence(berlin,'UTC','2026-10-01T00:00:00Z','2026-10-24T07:00:00Z'),'2026-10-25T07:00:00.000Z');
  assert.equal(nextRecurrence('DTSTART:20261001T080000Z\nRRULE:FREQ=DAILY;COUNT=1','Europe/Istanbul','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z'),'2026-10-01T08:00:00.000Z');
  assert.equal(nextRecurrence('DTSTART;TZID=Europe/Istanbul:20261001T080000\nRRULE:FREQ=DAILY;COUNT=3\nEXDATE;TZID=Europe/Istanbul:20261002T080000','Europe/Istanbul','2026-10-01T00:00:00Z','2026-10-01T06:00:00Z'),'2026-10-03T05:00:00.000Z');
  assert.equal(nextRecurrence('FREQ=MINUTELY;INTERVAL=30','Europe/Istanbul','2026-10-01T00:00:00Z','2026-10-01T00:01:00Z'),'2026-10-01T00:30:00.000Z');
});
test('continueTask retains actual execution thread/computer/config and waits for the active original turn',async()=>{
  const store=new SqliteStore(':memory:');const runner=new GateRunner();const runtime=new OrbitRuntime(store,runner,{maxParallelTasks:3});const dot=runtime.createDot({name:'Continuation',model:'old-model',reasoningEffort:'high',serviceTier:'priority'});
  const original=runtime.createTask({dotId:dot.id,input:'original',computerId:'original-worker',cwd:'D:/original-workspace'});runtime.start();await until(()=>runner.calls.length===1);
  const actualThread=runtime.getTask(original.id).threadId!;runtime.updateDot(dot.id,{computerId:'new-selected-worker',model:'new-model',reasoningEffort:'low',serviceTier:'default'});
  const followup=runtime.continueTask(original.id,{input:'continue',title:'Follow up'});const delegate=runtime.delegateTask(original.id,{input:'independent child'});
  await until(()=>runner.calls.length===2);assert.equal(runner.calls[1].input.task.id,delegate.id);assert.equal(runtime.getTask(followup.id).status,'queued');assert.equal(followup.parentTaskId,original.id);assert.equal(followup.source,'manual');assert.equal(followup.threadId,actualThread);assert.equal(followup.computerId,'original-worker');assert.equal(followup.model,'old-model');assert.equal(followup.reasoningEffort,'high');assert.equal(followup.serviceTier,'priority');assert.equal(followup.cwd,'D:/original-workspace');assert.equal(runtime.getDot(dot.id).rootThreadId,null);
  runner.complete(0);await until(()=>runner.calls.length===3);assert.equal(runner.calls[2].input.task.id,followup.id);assert.equal(runner.calls[2].input.task.threadId,actualThread);assert.equal(runtime.getDot(dot.id).rootThreadId,null);runner.complete(1);runner.complete(2);await until(()=>runtime.getTask(followup.id).status==='completed');await runtime.stop();store.close();
});
test('all tasks sharing an explicit actual thread serialize even across dots; fresh independent delegates stay parallel',async()=>{
  const store=new SqliteStore(':memory:');const runner=new GateRunner();const runtime=new OrbitRuntime(store,runner,{maxParallelTasks:4});const a=runtime.createDot({name:'A'});const b=runtime.createDot({name:'B'});
  const first=runtime.createTask({dotId:a.id,input:'first shared',threadId:'actual-shared'});const second=runtime.createTask({dotId:b.id,input:'second shared',threadId:'actual-shared'});const independent=runtime.createTask({dotId:a.id,input:'independent'});
  runtime.start();await until(()=>runner.calls.length===2);assert.deepEqual(runner.calls.map(call=>call.input.task.id),[first.id,independent.id]);assert.equal(runtime.getTask(second.id).status,'queued');runner.complete(0);await until(()=>runner.calls.length===3);assert.equal(runner.calls[2].input.task.id,second.id);runner.complete(1);runner.complete(2);await until(()=>runtime.getTask(second.id).status==='completed');await runtime.stop();store.close();
});
test('chat and explicit followups take the same root-thread lock before and after the first thread hook',async()=>{
  const store=new SqliteStore(':memory:');const runner=new GateRunner();const runtime=new OrbitRuntime(store,runner,{maxParallelTasks:4});const dot=runtime.createDot({name:'Chat lock'});
  const first=runtime.submitMessage(dot.id,{text:'first chat'}).task;const second=runtime.submitMessage(dot.id,{text:'second chat'}).task;runtime.start();await until(()=>runner.calls.length===1);
  const root=runtime.getDot(dot.id).rootThreadId!;const explicit=runtime.createTask({dotId:dot.id,input:'explicit manual on root',threadId:root});await new Promise(resolve=>setTimeout(resolve,10));assert.equal(runner.calls.length,1);
  runner.complete(0);await until(()=>runner.calls.length===2);assert.equal(runner.calls[1].input.task.id,second.id);assert.equal(runner.calls[1].input.task.threadId,root);assert.equal(runtime.getTask(explicit.id).status,'queued');runner.complete(1);await until(()=>runner.calls.length===3);assert.equal(runner.calls[2].input.task.id,explicit.id);runner.complete(2);await until(()=>runtime.getTask(explicit.id).status==='completed');await runtime.stop();store.close();
});
test('verified thread attachments persist references without inventing work and may be continued later',async()=>{
  const store=new SqliteStore(':memory:');const runner=new GateRunner();const runtime=new OrbitRuntime(store,runner);const dot=runtime.createDot({name:'Attached'});const other=runtime.createDot({name:'Other'});
  const attachment=runtime.attachThread(dot.id,{threadId:'existing-real-thread',computerId:'worker-actual',title:'Existing conversation',model:'actual-model',reasoningEffort:'high',serviceTier:'priority',cwd:'D:/worker/root'});assert.equal(runtime.listTasks().length,0);assert.equal(runtime.listMessages(dot.id).length,0);assert.equal(runtime.listAttachedThreads(dot.id)[0].id,attachment.id);
  assert.throws(()=>runtime.continueThread(other.id,'existing-real-thread',{input:'cross-dot'}),/Attach the verified/);
  const continued=runtime.continueThread(dot.id,'existing-real-thread',{input:'New instruction'});assert.equal(continued.threadId,'existing-real-thread');assert.equal(continued.computerId,'worker-actual');assert.equal(continued.parentTaskId,null);assert.equal(continued.model,'actual-model');assert.equal(continued.title,'Existing conversation');runtime.start();await until(()=>runner.calls.length===1);assert.equal(runner.calls[0].input.task.threadId,'existing-real-thread');runner.complete(0);await until(()=>runtime.getTask(continued.id).status==='completed');assert.equal(runtime.getDot(dot.id).rootThreadId,null);
  const next=runtime.continueThread(dot.id,'existing-real-thread',{input:'Next instruction'});assert.equal(next.parentTaskId,continued.id);await runtime.stop();store.close();
});
test('continuation rejects missing or synthetic threads and follows actual parent migration before admission',async()=>{
  const store=new SqliteStore(':memory:');const runner=new GateRunner();const runtime=new OrbitRuntime(store,runner,{maxParallelTasks:3});const dot=runtime.createDot({name:'Migration'});
  const original=runtime.createTask({dotId:dot.id,input:'original'});assert.throws(()=>runtime.continueTask(original.id,{input:'too early'}),/no real execution thread/);assert.throws(()=>runtime.attachThread(dot.id,{threadId:'tool:external-send'}),/Only real execution/);
  runtime.start();await until(()=>runner.calls.length===1);const followup=runtime.continueTask(original.id,{input:'continue after migration'});runner.calls[0].hooks.onThread('actual-migrated-thread');runtime.tick();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(runner.calls.length,1);assert.equal(runtime.getTask(followup.id).threadId,'actual-migrated-thread');runner.calls[0].resolve({text:'done',threadId:'actual-migrated-thread',turnId:'turn-parent'});await until(()=>runner.calls.length===2);assert.equal(runner.calls[1].input.task.threadId,'actual-migrated-thread');runner.complete(1);await until(()=>runtime.getTask(followup.id).status==='completed');await runtime.stop();store.close();
});
