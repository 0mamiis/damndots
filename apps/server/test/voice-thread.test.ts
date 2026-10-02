import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteStore} from '../src/storage.js';
import {OrbitRuntime} from '../src/runtime/index.js';
import {voicePrefix} from '../src/voice-text.js';
import type {RunInput,RunnerHooks,TaskRunner} from '@dots/contracts';

const until=async(check:()=>boolean)=>{const end=Date.now()+3000;while(!check()){if(Date.now()>end)throw Error('Timed out');await new Promise(r=>setTimeout(r,2));}};
class Recorder implements TaskRunner {
 seen:{task:string;thread:string|null;effort:string|null}[]=[];
 async run(input:RunInput,hooks:RunnerHooks){
  this.seen.push({task:input.task.input,thread:input.task.threadId,effort:input.task.reasoningEffort});
  const thread=input.task.threadId??'thread-for-'+input.task.input.replace(/\W+/g,'-');hooks.onThread(thread);hooks.onTurn('turn-'+input.task.id);
  return {text:'ok',threadId:thread,turnId:'turn-'+input.task.id};
 }
}

test('each voice call gets its own light thread and never replaces the chat thread',async()=>{
 const store=new SqliteStore(':memory:'),runner=new Recorder(),runtime=new OrbitRuntime(store,runner,{maxParallelTasks:2});
 const dot=runtime.createDot({name:'Null'});runtime.start();
 const chat=runtime.submitMessage(dot.id,{text:'long chat'}).task;await until(()=>runtime.getTask(chat.id).status==='completed');
 const chatThread=runtime.getDot(dot.id).rootThreadId;assert.ok(chatThread);
 const first=runtime.submitMessage(dot.id,{text:'voice one',channel:'voice',requestId:'call-a:1'}).task;await until(()=>runtime.getTask(first.id).status==='completed');
 assert.equal(runtime.getDot(dot.id).rootThreadId,chatThread,'a voice call must not take over the chat root');
 const voiceThread=runtime.getTask(first.id).threadId;assert.ok(voiceThread);assert.notEqual(voiceThread,chatThread);
 const second=runtime.submitMessage(dot.id,{text:'voice two',channel:'voice',requestId:'call-a:2'}).task;await until(()=>runtime.getTask(second.id).status==='completed');
 assert.equal(runtime.getTask(second.id).threadId,voiceThread,'the same call continues its thread');
 const third=runtime.submitMessage(dot.id,{text:'voice three',channel:'voice',requestId:'call-b:1'}).task;await until(()=>runtime.getTask(third.id).status==='completed');
 assert.notEqual(runtime.getTask(third.id).threadId,voiceThread,'a new call starts a fresh thread');
 assert.equal(runtime.getDot(dot.id).rootThreadId,chatThread);
 assert.equal(runtime.getTask(first.id).reasoningEffort,'low');assert.equal(runtime.getTask(chat.id).reasoningEffort,null);
 runtime.stop();
});
test('a fresh voice thread starts with the recent chat; a continuing one only gets the style note',()=>{
 const messages=[{taskId:'1',role:'user',text:'Blender kurar misin?'},{taskId:'1',role:'assistant',text:'Kurdum.'},{taskId:'2',role:'user',text:'şu an sorulan'}];
 const fresh=voicePrefix('Null',messages,'2',true);
 assert.match(fresh,/Blender kurar misin\?/);assert.match(fresh,/You: Kurdum\./);assert.doesNotMatch(fresh,/şu an sorulan/);
 const next=voicePrefix('Null',messages,'2',false);assert.doesNotMatch(next,/Blender/);assert.match(next,/Null/);
});
