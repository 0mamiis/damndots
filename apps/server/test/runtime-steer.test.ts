import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../src/storage.js';
import { OrbitRuntime } from '../src/runtime/index.js';
import type { RunInput, RunResult, RunnerHooks, Task, TaskRunner } from '@dots/contracts';

async function until(check:()=>boolean):Promise<void> {
  const deadline=Date.now()+3000;
  while(!check()) {if(Date.now()>deadline) throw new Error('Timed out waiting for runtime state');await new Promise(resolve=>setTimeout(resolve,2));}
}
class GateRunner implements TaskRunner {
  calls:Array<{input:RunInput;hooks:RunnerHooks;signal:AbortSignal;resolve:(value:RunResult)=>void}>=[];
  run(input:RunInput,hooks:RunnerHooks,signal:AbortSignal):Promise<RunResult> {
    hooks.onThread(input.task.threadId??'thread-'+input.task.id);hooks.onTurn('turn-'+input.task.id);
    return new Promise((resolve,reject)=>{
      this.calls.push({input,hooks,signal,resolve});
      signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
    });
  }
  complete(index:number,text='done'):void {const c=this.calls[index];c.resolve({text,threadId:c.input.task.threadId??'thread-'+c.input.task.id,turnId:'turn-'+c.input.task.id});}
}

test('a chat message sent while a turn runs is delivered to that turn instead of waiting for it to finish',async()=>{
  const store=new SqliteStore(':memory:');const runner=new GateRunner();const sent:Array<{task:Task;text:string}>=[];
  const runtime=new OrbitRuntime(store,runner,{maxParallelTasks:2,steer:async(task,text)=>{sent.push({task,text});return true;}});
  const dot=runtime.createDot({name:'Null'});const first=runtime.submitMessage(dot.id,{text:'long job'}).task;runtime.start();await until(()=>runner.calls.length===1);
  const second=runtime.submitMessage(dot.id,{text:'give me a status report'}).task;
  await until(()=>runtime.getTask(second.id).status==='completed');
  assert.equal(sent.length,1);assert.equal(sent[0].text,'give me a status report');assert.equal(sent[0].task.id,first.id);assert.equal(sent[0].task.turnId,'turn-'+first.id);
  assert.equal(runner.calls.length,1,'the steered message must not start a second turn');
  assert.equal(runtime.getTask(second.id).threadId,null,'the stand-in task must not claim the running thread');
  assert.ok(runtime.listActivity({taskId:second.id}).some(a=>a.type==='task.steered'));
  runner.complete(0);await until(()=>runtime.getTask(first.id).status==='completed');await runtime.stop();store.close();
});

test('a message that cannot be steered stays queued and runs after the active turn',async()=>{
  const store=new SqliteStore(':memory:');const runner=new GateRunner();let attempts=0;
  const runtime=new OrbitRuntime(store,runner,{maxParallelTasks:2,steer:async()=>{attempts++;throw new Error('turn already finished');}});
  const dot=runtime.createDot({name:'Null'});runtime.submitMessage(dot.id,{text:'long job'});runtime.start();await until(()=>runner.calls.length===1);
  const second=runtime.submitMessage(dot.id,{text:'next'}).task;await until(()=>attempts===1);await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(runtime.getTask(second.id).status,'queued');assert.equal(runner.calls.length,1);
  runner.complete(0);await until(()=>runner.calls.length===2);assert.equal(runner.calls[1].input.task.id,second.id);runner.complete(1);await until(()=>runtime.getTask(second.id).status==='completed');
  assert.ok(runtime.listActivity({taskId:second.id}).some(a=>a.type==='task.steer_failed'));await runtime.stop();store.close();
});

test('voice calls, attachments and paused Dots never use live steering',async()=>{
  const store=new SqliteStore(':memory:');const runner=new GateRunner();let attempts=0;
  const runtime=new OrbitRuntime(store,runner,{maxParallelTasks:3,steer:async()=>{attempts++;return true;}});
  const dot=runtime.createDot({name:'Null'});runtime.submitMessage(dot.id,{text:'long job'});runtime.start();await until(()=>runner.calls.length===1);
  const voice=runtime.submitMessage(dot.id,{text:'voice one',channel:'voice',requestId:'call-a:1'}).task;
  await until(()=>runner.calls.length===2);assert.equal(runner.calls[1].input.task.id,voice.id);
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(attempts,0);
  runner.complete(0);runner.complete(1);await runtime.stop();store.close();
});

