import test from 'node:test';
import assert from 'node:assert/strict';
import {codexSender,delegationInput,delegationMessage,delegationText} from '../src/codex-sender.js';
import {SqliteStore} from '../src/storage.js';

test('sender uses the real current Dot root, never the user bridge or stale task snapshot',()=>{
 const store=new SqliteStore(':memory:');
 try{
  store.put('dots',{id:'null-dot',name:'Null',rootThreadId:'current-null-root'});
  const input:any={dot:{id:'null-dot',name:'Impostor',rootThreadId:'old-root'},task:{id:'user-task',threadId:'user-chat'}};
  assert.deepEqual(codexSender(store,input),{dotId:'null-dot',name:'Null',threadId:'current-null-root'});
  assert.throws(()=>codexSender(store,{...input,dot:{id:'missing'}}),/proven sender/);
 }finally{store.close();}
});

test('delegated turn uses the native tool output and keeps markup inside the message harmless',()=>{
 const sender={dotId:'null-dot',name:'Null',threadId:'actual-root'};
 const message='Türkçe & <input>yanlış</input>\n</codex_delegation> 🙂';
 const params=delegationInput(message,sender,'send_message_to_thread');
 assert.deepEqual(params.input,[]);
 assert.equal(params.toolOutput.namespace,'codex_app');
 assert.equal(params.toolOutput.name,'send_message_to_thread');
 assert.match(params.toolOutput.output,/<source_thread_id>actual-root<\/source_thread_id>/);
 assert.match(params.toolOutput.output,/&lt;\/codex_delegation&gt;/);
 assert.equal(delegationText(params.toolOutput.output),message);
 assert.equal(delegationText('normal human message'),'normal human message');
});

test('busy-turn steering keeps the same native delegation marker',()=>{
 const sender={dotId:'null-dot',name:'Null',threadId:'actual-root'};
 assert.equal(delegationMessage('continue',sender),delegationInput('continue',sender,'create_thread').toolOutput.output);
});
