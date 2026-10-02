import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer, WebSocket } from 'ws';
import { mkdtemp, mkdir, writeFile, rm, symlink,realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { AppServerRunner, inspectOutput, RpcClient } from '../src/runtime/runner.js';
import { OrbitRuntime } from '../src/runtime/index.js';
import { SqliteStore } from '../src/storage.js';
import type { Output, RunInput, RunnerHooks } from '@dots/contracts';

async function harness(handle:(message:any,socket:WebSocket)=>void) {
  const server=new WebSocketServer({port:0,host:'127.0.0.1'});await once(server,'listening');
  const frames:any[]=[];
  server.on('connection',socket=>socket.on('message',data=>{const message=JSON.parse(String(data));frames.push(message);handle(message,socket);}));
  return {url:`ws://127.0.0.1:${(server.address() as any).port}`,frames,async close(){for(const socket of server.clients) socket.terminate();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
function response(socket:WebSocket,message:any,result:any={}) {socket.send(JSON.stringify({id:message.id,result}));}
function notify(socket:WebSocket,method:string,params:any) {socket.send(JSON.stringify({method,params}));}
function fixture(cwd:string,source:RunInput['task']['source']='chat'):RunInput {
  const store=new SqliteStore(':memory:');const runtime=new OrbitRuntime(store,{run:async()=>{throw new Error('unused');}});const dot=runtime.createDot({name:'Runner',model:'gpt-6.1-sol',reasoningEffort:'high',serviceTier:'priority',instructions:'Use actual data'});const task=runtime.createTask({dotId:dot.id,input:'Produce an actual file',cwd,source});store.close();return {task,dot,memories:[]};
}
function hooks(outputs:Array<Omit<Output,'id'|'dotId'|'taskId'|'createdAt'>>=[],approve=true):RunnerHooks {return {onThread(){},onTurn(){},onDelta(){},onActivity(){},onOutput:output=>outputs.push(output),onApproval:async()=>approve};}

test('real WebSocket contract initializes, streams, handles server approval/dynamic calls and extracts actual artifact',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'dots-runner-'));const outputs:Array<Omit<Output,'id'|'dotId'|'taskId'|'createdAt'>>=[];
  let approvalDecision:any;let toolResult:any;let turnParams:any;let threadParams:any;
  const server=await harness((message,socket)=>{
    if(message.method==='initialize') {assert.equal(message.jsonrpc,undefined);response(socket,message);}
    else if(message.method==='thread/start') {threadParams=message.params;response(socket,message,{thread:{id:'thread-1',turns:[]}});}
    else if(message.method==='turn/start') {
      turnParams=message.params;response(socket,message,{turn:{id:'turn-1',status:'inProgress'}});
      socket.send(JSON.stringify({id:'approval-1',method:'item/commandExecution/requestApproval',params:{threadId:'thread-1',turnId:'turn-1',command:'write artifact'}}));
    }
    else if(message.id==='approval-1') {
      approvalDecision=message.result;socket.send(JSON.stringify({id:'tool-1',method:'item/tool/call',params:{threadId:'thread-1',turnId:'turn-1',tool:'lookup',arguments:{query:'real'},callId:'call-1'}}));
    }
    else if(message.id==='tool-1') {
      toolResult=message.result;
      void (async()=>{await mkdir(join(folder,'outputs'));await writeFile(join(folder,'outputs','result.md'),'actual content');notify(socket,'item/agentMessage/delta',{threadId:'thread-1',turnId:'turn-1',itemId:'message-1',delta:'Streaming'});notify(socket,'item/completed',{threadId:'thread-1',turnId:'turn-1',item:{id:'message-1',type:'agentMessage',phase:'final_answer',text:'Saved [result](outputs/result.md).'}});notify(socket,'turn/completed',{threadId:'thread-1',turn:{id:'turn-1',status:'completed',items:[]}});})();
    }
  });
  try {
    let callArgs:any;
    const runner=new AppServerRunner({url:server.url,tools:()=>[{name:'lookup',description:'Read data',inputSchema:{type:'object'}}],onToolCall:async(name,args)=>{callArgs={name,args};return {value:'actual'};}});
    const result=await runner.run(fixture(folder),hooks(outputs),new AbortController().signal);
    assert.equal(result.text,'Saved [result](outputs/result.md).');assert.deepEqual(approvalDecision,{decision:'accept'});assert.equal(toolResult.success,true);assert.equal(toolResult.contentItems[0].type,'inputText');assert.deepEqual(callArgs,{name:'lookup',args:{query:'real'}});
    assert.equal(threadParams.dynamicTools[0].type,'function');assert.equal(threadParams.model,'gpt-6.1-sol');assert.equal(threadParams.serviceTier,'priority');assert.equal(turnParams.effort,'high');assert.equal(turnParams.serviceTier,'priority');
    assert.equal(outputs.length,1);assert.equal(outputs[0].size,14);assert.equal(outputs[0].path,await realpath(join(folder,'outputs','result.md')));
    assert.deepEqual(server.frames.slice(0,4).map(frame=>frame.method),['initialize','initialized','thread/start','turn/start']);
  } finally {await server.close();await rm(folder,{recursive:true,force:true});}
});
test('AbortSignal sends actual turn/interrupt and waits for upstream completion before resolving abort',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'dots-interrupt-'));const controller=new AbortController();let acknowledged=false;let emittedCompleted=false;
  const server=await harness((message,socket)=>{
    if(message.method==='initialize') response(socket,message);
    else if(message.method==='thread/start') response(socket,message,{thread:{id:'thread-abort'}});
    else if(message.method==='turn/start') {response(socket,message,{turn:{id:'turn-abort',status:'inProgress'}});setTimeout(()=>controller.abort(),5);}
    else if(message.method==='turn/interrupt') {assert.equal(message.params.threadId,'thread-abort');assert.equal(message.params.turnId,'turn-abort');acknowledged=true;response(socket,message);setTimeout(()=>{emittedCompleted=true;notify(socket,'turn/completed',{threadId:'thread-abort',turn:{id:'turn-abort',status:'interrupted'}});},15);}
  });
  try {const runner=new AppServerRunner({url:server.url});await assert.rejects(runner.run(fixture(folder),hooks(),controller.signal),{name:'AbortError'});assert.equal(acknowledged,true);assert.equal(emittedCompleted,true);assert.equal(server.frames.filter(f=>f.method==='turn/interrupt').length,1);} finally {await server.close();await rm(folder,{recursive:true,force:true});}
});
test('resumed thread interrupts surviving stale turn before starting a new turn',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'dots-resume-'));let staleStopped=false;
  const server=await harness((message,socket)=>{
    if(message.method==='initialize') response(socket,message);
    else if(message.method==='thread/resume') {assert.equal(message.params.threadId,'existing-thread');assert.equal(message.params.dynamicTools,undefined);response(socket,message,{thread:{id:'existing-thread',turns:[{id:'stale-turn',status:'inProgress'}]}});}
    else if(message.method==='turn/interrupt') {assert.equal(message.params.turnId,'stale-turn');response(socket,message);setTimeout(()=>{staleStopped=true;notify(socket,'turn/completed',{threadId:'existing-thread',turn:{id:'stale-turn',status:'interrupted'}});},10);}
    else if(message.method==='turn/start') {assert.equal(staleStopped,true);response(socket,message,{turn:{id:'new-turn',status:'inProgress'}});notify(socket,'turn/completed',{threadId:'existing-thread',turn:{id:'new-turn',status:'completed',items:[{type:'agentMessage',id:'final',text:'Resumed'}]}});}
  });
  try {const input=fixture(folder);input.task.threadId='existing-thread';const result=await new AppServerRunner({url:server.url}).run(input,hooks(),new AbortController().signal);assert.equal(result.text,'Resumed');assert.equal(result.threadId,'existing-thread');} finally {await server.close();await rm(folder,{recursive:true,force:true});}
});
test('restart reattaches an exact live turn and recovers already-completed work without duplicate turn/start',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'dots-reconcile-'));
  for(const live of [true,false]) {
    const server=await harness((message,socket)=>{
      if(message.method==='initialize') response(socket,message);
      else if(message.method==='thread/resume') {
        response(socket,message,{thread:{id:'persisted-thread',turns:[{id:'persisted-turn',status:live?'inProgress':'completed',items:live?[]:[{id:'reply',type:'agentMessage',phase:'final_answer',text:'Exactly once'}]}]}});
        if(live) setTimeout(()=>notify(socket,'turn/completed',{threadId:'persisted-thread',turn:{id:'persisted-turn',status:'completed',items:[{id:'reply',type:'agentMessage',phase:'final_answer',text:'Exactly once'}]}}),10);
      }
      else if(message.method==='turn/start') assert.fail('Recovered work must not be submitted again');
      else if(message.method==='turn/interrupt') assert.fail('Live recovered turn should continue');
    });
    try {const input=fixture(folder);input.task.threadId='persisted-thread';input.task.turnId='persisted-turn';const result=await new AppServerRunner({url:server.url}).run(input,hooks(),new AbortController().signal);assert.equal(result.text,'Exactly once');assert.equal(result.turnId,'persisted-turn');assert.equal(server.frames.some(frame=>frame.method==='turn/start'),false);} finally {await server.close();}
  }
  await rm(folder,{recursive:true,force:true});
});
test('missing persisted turn fails closed rather than repeating a task',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'dots-missingturn-'));
  const server=await harness((message,socket)=>{if(message.method==='initialize') response(socket,message);else if(message.method==='thread/resume'||message.method==='thread/read') response(socket,message,{thread:{id:'persisted-thread',turns:[]}});else if(message.method==='turn/start') assert.fail('Cannot repeat unreconciled work');});
  try {const input=fixture(folder);input.task.threadId='persisted-thread';input.task.turnId='missing-turn';await assert.rejects(new AppServerRunner({url:server.url}).run(input,hooks(),new AbortController().signal),/could not be reconciled/);assert.ok(server.frames.some(frame=>frame.method==='thread/read'));} finally {await server.close();await rm(folder,{recursive:true,force:true});}
});
test('proactive execution uses a read-only sandbox with restricted shell network and denies approval',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'dots-readonly-'));let approvals=0;let decision:any;
  const server=await harness((message,socket)=>{
    if(message.method==='initialize') response(socket,message);
    else if(message.method==='thread/start') {assert.equal(message.params.sandbox,'read-only');assert.equal(message.params.approvalPolicy,'never');response(socket,message,{thread:{id:'research'}});}
    else if(message.method==='turn/start') {assert.deepEqual(message.params.sandboxPolicy,{type:'readOnly',networkAccess:false});response(socket,message,{turn:{id:'research-turn',status:'inProgress'}});socket.send(JSON.stringify({id:'request-write',method:'item/fileChange/requestApproval',params:{threadId:'research',turnId:'research-turn',reason:'write file'}}));}
    else if(message.id==='request-write') {decision=message.result;notify(socket,'turn/completed',{threadId:'research',turn:{id:'research-turn',status:'completed',items:[]}});}
  });
  try {const runHooks=hooks();runHooks.onApproval=async()=>{approvals++;return true;};await new AppServerRunner({url:server.url}).run(fixture(folder,'proactive'),runHooks,new AbortController().signal);assert.equal(approvals,0);assert.deepEqual(decision,{decision:'decline'});} finally {await server.close();await rm(folder,{recursive:true,force:true});}
});
test('failed turn and transport loss reject; they cannot be reported as completed tasks',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'dots-failed-'));
  for(const disconnect of [false,true]) {
    const server=await harness((message,socket)=>{
      if(message.method==='initialize') response(socket,message);
      else if(message.method==='thread/start') response(socket,message,{thread:{id:'thread-failure'}});
      else if(message.method==='turn/start') {response(socket,message,{turn:{id:'turn-failure',status:'inProgress'}});if(disconnect) socket.close();else notify(socket,'turn/completed',{threadId:'thread-failure',turn:{id:'turn-failure',status:'failed',error:{message:'Model access denied'}}});}
    });
    try {await assert.rejects(new AppServerRunner({url:server.url}).run(fixture(folder),hooks(),new AbortController().signal),disconnect?/disconnected/:/Model access denied/);} finally {await server.close();}
  }
  await rm(folder,{recursive:true,force:true});
});
test('artifact validation rejects traversal and symlink escapes while inspecting real file metadata',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'dots-path-'));await mkdir(join(folder,'root'));await writeFile(join(folder,'outside.txt'),'private');await writeFile(join(folder,'root','inside.txt'),'okay');
  try {
    const output=await inspectOutput(join(folder,'root','inside.txt'),[join(folder,'root')]);assert.equal(output.size,4);
    await assert.rejects(inspectOutput(join(folder,'root','..','outside.txt'),[join(folder,'root')]),/escapes/);
    await assert.rejects(inspectOutput('relative.txt',[join(folder,'root')]),/absolute/);
    await symlink(folder,join(folder,'root','escape'),'junction');await assert.rejects(inspectOutput(join(folder,'root','escape','outside.txt'),[join(folder,'root')]),/escapes/);
  } finally {await rm(folder,{recursive:true,force:true});}
});
test('RPC timeout is bounded and server-request errors keep their request id',async()=>{
  let unsupported:any;
  const server=await harness((message,socket)=>{if(message.method==='initialize') {response(socket,message);socket.send(JSON.stringify({id:'server-request',method:'unsupported',params:{}}));}else if(message.id==='server-request') unsupported=message;});
  const client=new RpcClient({url:server.url,requestTimeoutMs:25});
  try {await client.request('initialize',{});await assert.rejects(client.request('unresponsive',{}),/timed out/);assert.equal(unsupported.id,'server-request');assert.equal(unsupported.error.code,-32601);} finally {client.close();await server.close();}
});
test('requestUserInput sends the actual user answer in the installed App Server schema',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'dots-userinput-'));let received:any;
  const server=await harness((message,socket)=>{
    if(message.method==='initialize') response(socket,message);
    else if(message.method==='thread/start') response(socket,message,{thread:{id:'question-thread'}});
    else if(message.method==='turn/start') {response(socket,message,{turn:{id:'question-turn',status:'inProgress'}});socket.send(JSON.stringify({id:'question-rpc',method:'item/tool/requestUserInput',params:{threadId:'question-thread',turnId:'question-turn',itemId:'question-item',isBlocking:true,questions:[{id:'pick',header:'Option',question:'Which?',options:[{label:'A',description:'First'},{label:'B',description:'Second'}]}]}}));}
    else if(message.id==='question-rpc') {received=message.result;notify(socket,'turn/completed',{threadId:'question-thread',turn:{id:'question-turn',status:'completed',items:[]}});}
  });
  try {const runHooks=hooks();runHooks.onUserInput=async request=>{assert.equal((request.request.questions as any)[0].id,'pick');return {answers:{pick:{answers:['B']}}};};await new AppServerRunner({url:server.url}).run(fixture(folder),runHooks,new AbortController().signal);assert.deepEqual(received,{answers:{pick:{answers:['B']}}});} finally {await server.close();await rm(folder,{recursive:true,force:true});}
});
test('known tool-incompatible thread migrates with durable conversation context and keeps old mapping in activity',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'dots-toolmigration-'));let text='';let marked='';const activities:any[]=[];
  const server=await harness((message,socket)=>{
    if(message.method==='initialize') response(socket,message);
    else if(message.method==='thread/resume') assert.fail('Cannot refresh tools on a legacy thread');
    else if(message.method==='thread/start') {assert.equal(message.params.dynamicTools[0].name,'dot_task_delegate');response(socket,message,{thread:{id:'tools-thread'}});}
    else if(message.method==='turn/start') {text=message.params.input[0].text;response(socket,message,{turn:{id:'tools-turn',status:'inProgress'}});notify(socket,'turn/completed',{threadId:'tools-thread',turn:{id:'tools-turn',status:'completed',items:[]}});}
  });
  try {const input=fixture(folder);input.task.threadId='legacy-thread';const runHooks=hooks();runHooks.onActivity=(type,message,data)=>activities.push({type,message,data});const runner=new AppServerRunner({url:server.url,threadHasTools:()=>false,onToolsThread:threadId=>{marked=threadId;},contextHistory:()=> 'user: Keep my prior attachment reference /workspace/file.txt\nassistant: Prior result',tools:()=>[{name:'dot_task_delegate',description:'Delegate',inputSchema:{type:'object'}}]});const result=await runner.run(input,runHooks,new AbortController().signal);assert.equal(result.threadId,'tools-thread');assert.equal(marked,'tools-thread');assert.match(text,/Keep my prior attachment reference/);assert.ok(activities.some(a=>a.type==='thread.migrated'&&a.data.previousThreadId==='legacy-thread'&&a.data.threadId==='tools-thread'));} finally {await server.close();await rm(folder,{recursive:true,force:true});}
});
test('MCP form elicitation returns actual content, and cancelled form sends a decline',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'dots-mcpform-'));
  for(const accepted of [true,false]) {
    let received:any;
    const server=await harness((message,socket)=>{
      if(message.method==='initialize') response(socket,message);
      else if(message.method==='thread/start') response(socket,message,{thread:{id:'form-thread'}});
      else if(message.method==='turn/start') {response(socket,message,{turn:{id:'form-turn',status:'inProgress'}});socket.send(JSON.stringify({id:'form-rpc',method:'mcpServer/elicitation/request',params:{threadId:'form-thread',turnId:'form-turn',mode:'form',message:'Enter recipient',requestedSchema:{type:'object',properties:{recipient:{type:'string'}},required:['recipient']}}}));}
      else if(message.id==='form-rpc') {received=message.result;notify(socket,'turn/completed',{threadId:'form-thread',turn:{id:'form-turn',status:'completed',items:[]}});}
    });
    try {const runHooks=hooks();runHooks.onUserInput=async request=>{assert.equal(request.kind,'form_input');return accepted?{content:{recipient:'actual@example.invalid'}}:null;};await new AppServerRunner({url:server.url}).run(fixture(folder),runHooks,new AbortController().signal);assert.deepEqual(received,accepted?{action:'accept',content:{recipient:'actual@example.invalid'}}:{action:'decline',content:null});} finally {await server.close();}
  }
  await rm(folder,{recursive:true,force:true});
});
