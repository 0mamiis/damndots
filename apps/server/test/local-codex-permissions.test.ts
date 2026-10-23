import test from 'node:test';
import assert from 'node:assert/strict';
import {DotTools} from '../src/tools.js';
import {SqliteStore} from '../src/storage.js';
import {LocalCodex,LocalCodexError} from '../src/local-codex.js';
import {createServer} from 'node:http';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {once} from 'node:events';

test('archived local chats return an actionable conflict instead of a hidden HTTP 500',()=>{
 const e=new LocalCodexError('session controlled-thread is archived. Run codex unarchive first.');assert.equal(e.statusCode,409);assert.match(e.message,/archived/);assert.match(e.message,/Do not retry/);
 const other=new LocalCodexError('The local Codex app did not respond');assert.equal(other.statusCode,502);assert.match(other.message,/did not respond/);
});

test('bridge HTTP errors and failed desktop tool results preserve archived-chat conflicts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dots-local-error-')),tokenFile=join(dir,'token.txt');await writeFile(tokenFile,'controlled-test-token');
 let mode='http';const server=createServer((req,res)=>{req.resume();res.writeHead(mode==='http'?502:200,{'content-type':'application/json'});res.end(JSON.stringify(mode==='http'?{error:'session fixture is archived. Run codex unarchive first.'}:{success:false,contentItems:[{type:'inputText',text:'session fixture is archived. Run codex unarchive first.'}]}));});
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');
 const client=new LocalCodex();Object.assign(client,{tokenFile,url:'http://127.0.0.1:'+address.port});
 try{for(const next of ['http','tool']){mode=next;await assert.rejects(client.call('local_codex_thread_read',{threadId:'fixture'}),(e:unknown)=>e instanceof LocalCodexError&&e.statusCode===409&&e.message.includes('archived'));}}
 finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true});}
});

test('local chat creation forwards the requested model without changing the local target',async()=>{
 const client=new LocalCodex();let captured:any;
 (client as any).request=async(tool:string,args:any)=>{captured={tool,args};return {ok:true};};
 await client.call('local_codex_thread_start',{projectId:'project',message:'hello',model:'  selected/model  ',name:'Test'});
 assert.equal(captured.tool,'create_thread');assert.equal(captured.args.model,'selected/model');assert.deepEqual(captured.args.target,{type:'project',projectId:'project',environment:{type:'local'}});
 await client.call('local_codex_thread_start',{projectId:'project',message:'hello'});assert.ok(!('model' in captured.args));
});

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
