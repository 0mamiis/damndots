import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SqliteStore} from '../src/storage.js';
import {dotBrowserSession} from '../src/browser-session.js';
import {buildServer} from '../src/app.js';
import {DotTools} from '../src/tools.js';

test('browser identity survives panel reload and stays separate per Dot/computer',()=>{
 const store=new SqliteStore(':memory:');try{
  const first=dotBrowserSession(store,'genius','pc');
  assert.deepEqual(dotBrowserSession(store,'genius','pc'),first);
  assert.notEqual(dotBrowserSession(store,'other','pc').sessionId,first.sessionId);
  assert.notEqual(dotBrowserSession(store,'genius','other-pc').sessionId,first.sessionId);
  assert.throws(()=>dotBrowserSession(store,'other','pc',first.sessionId),/does not belong/);
  assert.throws(()=>dotBrowserSession(store,'genius','pc','unknown'),/does not belong/);
 }finally{store.close();}
});

test('native panel and agent share a session while grants still isolate commands and screenshots',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dots-viewer-'));
 const f=await buildServer({store:new SqliteStore(':memory:'),runner:{run:async()=>{throw new Error('No inference expected');}},config:{host:'127.0.0.1',port:0,dataDir:dir,adminKey:'test-key',signingKey:Buffer.alloc(32,1),modelBaseUrl:'http://localhost:10100/v1',modelApiKey:'',appServerUrl:'ws://localhost:9912',model:null,reasoningEffort:'high',serviceTier:null,workerOnlineMs:45000}});
 try{
  await f.app.ready();
  const computer=f.workers.register({token:f.auth.enroll('worker').token,name:'PC',platform:'test',roots:[dir],capabilities:['codex','browser']});
  const dot=f.runtime.createDot({name:'Genius',computerId:computer.computerId}),other=f.runtime.createDot({name:'Other',computerId:computer.computerId});
  const task=f.runtime.createTask({dotId:dot.id,input:'Test'}),input={dot,task};
  const tools=new DotTools(()=>f.runtime,()=>f.integrations,f.workers,f.store);
  const pending=tools.call('dot_browser_action',{computerId:computer.computerId,action:'open',url:'https://example.test'},input as any,new AbortController().signal);
  const agentJob=f.workers.next(computer.computerId)!;
  assert.equal(agentJob.payload.dotId,dot.id);
  f.workers.finish(computer.computerId,agentJob.id,{sessionId:agentJob.payload.sessionId,url:'https://example.test',control:'agent'});await pending;
  const access=f.auth.nativeTokens('viewer-client').access_token;
  const headers={authorization:'Bearer '+access};
  const base='/backend-api/tbo/'+dot.id+'/computer/viewer';
  const page=await f.app.inject({url:base,headers});assert.equal(page.statusCode,200);
  const bootstrap=JSON.parse(page.body.match(/const cfg=(.*?);let sessionId=/)![1]);
  assert.equal(bootstrap.sessionId,agentJob.payload.sessionId);
  const reopened=await f.app.inject({url:base,headers});const second=JSON.parse(reopened.body.match(/const cfg=(.*?);let sessionId=/)![1]);assert.equal(second.sessionId,bootstrap.sessionId);
  const control=await f.app.inject({method:'POST',url:base+'/control',headers,payload:{token:bootstrap.token,action:'open'}});assert.equal(control.statusCode,200);
  const job=f.workers.next(computer.computerId)!;assert.equal(job.payload.sessionId,agentJob.payload.sessionId);
  const image=await f.blobs.put(Buffer.from('png-bytes'),'screen.png','image/png',dot.id);
  f.workers.finish(computer.computerId,job.id,{sessionId:job.payload.sessionId,url:'https://example.test',control:'agent',screenshotId:image.id});
  const fetchShot=(token:string,url=base)=>f.app.inject({url:url+'/screenshots/'+image.id+'?t='+encodeURIComponent(token),headers});
  assert.equal((await fetchShot(bootstrap.token)).statusCode,200);
  assert.equal((await fetchShot(second.token)).statusCode,403);
  assert.equal((await fetchShot(bootstrap.token,'/backend-api/tbo/'+other.id+'/computer/viewer')).statusCode,401);
  assert.equal((await f.app.inject({method:'POST',url:base+'/control',headers,payload:{token:bootstrap.token,action:'screenshot',sessionId:dotBrowserSession(f.store,other.id,computer.computerId).sessionId}})).statusCode,403);
  assert.equal((await f.app.inject({url:base+'/jobs/'+agentJob.id+'?t='+encodeURIComponent(bootstrap.token),headers})).statusCode,403);
 }finally{await f.app.close();await rm(dir,{recursive:true,force:true});}
});
