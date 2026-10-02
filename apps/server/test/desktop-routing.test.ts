import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteStore} from '../src/storage.js';
import {AuthService} from '../src/auth.js';
import {WorkerBroker} from '../src/workers.js';
import {OrbitRuntime} from '../src/runtime/index.js';
import {dotBrowserSession} from '../src/browser-session.js';
import {DotTools} from '../src/tools.js';
import {BlobStore} from '../src/blobs.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('desktop execution reuses the panel session, preserves real history, and rejects unowned RPCs',()=>{
 const store=new SqliteStore(':memory:'),auth=new AuthService(Buffer.alloc(32,1),'test',store),workers=new WorkerBroker(store,auth);
 const runtime=new OrbitRuntime(store,{run:async()=>{throw Error('No inference in routing check');}});
 try{
  const computer=workers.register({token:auth.enroll('worker').token,name:'Linux',platform:'linux',roots:['/home/dot/Workspace'],capabilities:['codex','browser','desktop']});
  const dot=runtime.createDot({name:'Null',computerId:computer.computerId}),other=runtime.createDot({name:'Other',computerId:computer.computerId});
  store.put('messages',{id:'previous',dotId:dot.id,taskId:'old',role:'user',text:'Keep my files'});
  store.put('messages',{id:'foreign',dotId:other.id,taskId:'foreign',role:'user',text:'Private other context'});
  const task=runtime.createTask({dotId:dot.id,input:'Continue',computerId:computer.computerId});
  store.put('messages',{id:'current',dotId:dot.id,taskId:task.id,role:'user',text:'Continue'});
  const job=workers.queue(computer.computerId,'codex',{input:{task,dot,memories:[]}});
  assert.equal(job.payload.desktopSessionId,dotBrowserSession(store,dot.id,computer.computerId).sessionId);
  assert.equal(job.payload.contextHistory,'user: Keep my files');
  store.put('tasks',{...task,threadId:'actual-linux-thread',status:'completed'});
  const rpc=workers.queue(computer.computerId,'rpc',{request:{method:'thread/read',params:{threadId:'actual-linux-thread'}}});
  assert.equal(rpc.payload.desktopSessionId,job.payload.desktopSessionId);
  assert.throws(()=>workers.queue(computer.computerId,'rpc',{request:{method:'thread/read',params:{threadId:'unowned-thread'}}}),/no proven Dot owner/);
  assert.throws(()=>workers.queue(computer.computerId,'codex',{input:{task:{...task,dotId:other.id},dot,memories:[]}}),/does not belong/);
 }finally{workers.close();store.close();}
});

test('desktop screenshots stored as blobs reach the model as real inputImage content',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'dots-desktop-tools-')),store=new SqliteStore(':memory:');
 const auth=new AuthService(Buffer.alloc(32,1),'test',store),workers=new WorkerBroker(store,auth),runtime=new OrbitRuntime(store,{run:async()=>{throw Error('No inference expected');}}),blobs=new BlobStore(directory,store);
 try{
  const computer=workers.register({token:auth.enroll('worker').token,name:'Linux',platform:'linux',roots:['/home/dot/Workspace'],capabilities:['browser','desktop','codex']});
  const dot=runtime.createDot({name:'Null'}),task=runtime.createTask({dotId:dot.id,input:'Read the desktop'}),tools=new DotTools(()=>runtime,()=>({} as any),workers,store,blobs);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2X6kAAAAASUVORK5CYII=','base64'),image=await blobs.put(png,'browser.png','image/png');
  const result=tools.call('dot_desktop_action',{computerId:computer.computerId,action:'screenshot'},{task,dot,memories:[]},new AbortController().signal);
  const job=workers.next(computer.computerId)!;assert.equal(job.kind,'desktop');workers.finish(computer.computerId,job.id,{width:1280,height:800,screenshotId:image.id});
  const content=await result as any;assert.equal(content.success,true);assert.equal(content.contentItems[1].type,'inputImage');assert.equal(content.contentItems[1].imageUrl,'data:image/png;base64,'+png.toString('base64'));
 }finally{workers.close();store.close();await rm(directory,{recursive:true,force:true});}
});
