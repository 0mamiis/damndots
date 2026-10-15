import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {UpdateService,releaseInfo,newerVersion,versionParts,REPOSITORY} from '../src/updates.js';
const release=(tag='v0.3.0')=>({tag_name:tag,html_url:REPOSITORY+'/releases/tag/'+tag,body:'Notes',published_at:'2026-10-15T00:00:00Z',draft:false,prerelease:false});
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'dots-update-')),dataDir=join(root,'.data/server');
 await writeFile(join(root,'package.json'),JSON.stringify({name:'damndots',version:'0.2.2'}));
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,stdio:'pipe',windowsHide:true});
 git('init');git('config','user.email','test@example.com');git('config','user.name','Test');git('add','package.json');git('commit','-m','initial');git('remote','add','origin',REPOSITORY+'.git');
 let busy=false,calls=0,maint=false,launches=0,time=100000,busyCalls=0;
 let value:any=release(),fail=false;
 const service=new UpdateService({root,dataDir,stackPid:123,busy:()=>{busyCalls++;return busy;},maintenance:v=>maint=v,clock:()=>time,launch:async()=>{launches++;},fetch:async()=>{calls++;if(fail)throw Error('Network unavailable');return new Response(JSON.stringify(value));}});
 return {root,dataDir,service,git,get calls(){return calls;},get maint(){return maint;},get launches(){return launches;},busy:()=>{busy=true;},time:(v:number)=>{time=v;},fail:(value=true)=>{fail=value;},get busyCalls(){return busyCalls;},value:(v:any)=>{value=v;},close:()=>rm(root,{recursive:true,force:true})};
}
test('stable release parsing is numeric, excludes prereleases/drafts and locks links to the official repository',()=>{
 assert.equal(newerVersion('v0.10.0','0.9.9'),true);assert.equal(newerVersion('v1.0.0','1.0.0'),false);assert.equal(newerVersion('v0.2.1','0.2.2'),false);
 for(const v of ['v01.2.3','1.2','v1.2.3-rc.1','v1.2.3;cmd','99999999999999999999.0.0'])assert.equal(versionParts(v),null);
 assert.throws(()=>releaseInfo({...release(),prerelease:true}));assert.throws(()=>releaseInfo({...release(),draft:true}));assert.throws(()=>releaseInfo({...release(),html_url:'https://evil.example.com'}));
});
test('release checks are deduplicated, throttled and preserve a successful result on network failure',async()=>{
 const f=await fixture();try{
  await Promise.all([f.service.status(),f.service.status(),f.service.status()]);assert.equal(f.calls,1);
  assert.equal((await f.service.status()).available,true);
  await f.service.status(true);assert.equal(f.calls,1);
  f.fail();f.time(170001);const status=await f.service.status(true);
  assert.equal(f.calls,2);assert.equal(status.latest?.tag,'v0.3.0');assert.match(status.error!,/Network/);
 }finally{await f.close();}
});
test('apply pins the checked release, takes a lock and enters maintenance without spawning arbitrary commands',async()=>{
 const f=await fixture();try{
  await assert.rejects(f.service.start('v9.9.9'),/Check releases/);
  const job=await f.service.start('v0.3.0');assert.equal(job.status,'preparing');assert.equal(f.launches,1);assert.equal(f.maint,true);
  await assert.rejects(f.service.start('v0.3.0'),/already running/);
  assert.equal((await readFile(join(f.dataDir,'updates/update.lock'),'utf8')),job.id);
  const file=join(f.dataDir,'updates/job.json');const stored=JSON.parse(await readFile(file,'utf8'));
  await writeFile(file,JSON.stringify({...stored,status:'failed'}));await f.service.syncMaintenance();assert.equal(f.maint,false);
 }finally{await f.close();}
});
test('active work, modified source and an unrelated origin all prevent application',async()=>{
 const f=await fixture();try{
  f.busy();await assert.rejects(f.service.start('v0.3.0'),/active tasks/);assert.equal(f.launches,0);
 }finally{await f.close();}
 const dirty=await fixture();try{
  await writeFile(join(dirty.root,'package.json'),'{}');await assert.rejects(dirty.service.start('v0.3.0'),/Local source/);assert.equal(dirty.launches,0);assert.equal(dirty.maint,false);
 }finally{await dirty.close();}
 const foreign=await fixture();try{
  foreign.git('remote','set-url','origin','https://evil.example.com/repo');await assert.rejects(foreign.service.start('v0.3.0'),/official/);assert.equal(foreign.launches,0);
 }finally{await foreign.close();}
});
test('a failed updater launch releases its lock and maintenance state',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dots-update-launch-'));try{
  await writeFile(join(root,'package.json'),JSON.stringify({version:'0.2.2'}));
  for(const args of [['init'],['config','user.email','test@example.com'],['config','user.name','Test'],['add','package.json'],['commit','-m','initial'],['remote','add','origin',REPOSITORY]])execFileSync('git',args,{cwd:root,stdio:'ignore'});
  let maintenance=false;
  const s=new UpdateService({root,dataDir:join(root,'.data'),stackPid:100,busy:()=>false,maintenance:v=>{maintenance=v;},fetch:async()=>new Response(JSON.stringify(release())),launch:async()=>{throw Error('Cannot spawn');}});
  await assert.rejects(s.start('v0.3.0'),/Cannot spawn/);assert.equal(maintenance,false);
  await assert.rejects(readFile(join(root,'.data/updates/update.lock')),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('a failed first check retries with a growing delay instead of waiting an hour',async()=>{
 const f=await fixture();try{
  f.fail();await f.service.status();assert.equal(f.calls,1);
  await f.service.status();assert.equal(f.calls,1,'not retried immediately');
  f.time(100000+29000);await f.service.status();assert.equal(f.calls,1);
  f.time(100000+31000);await f.service.status();assert.equal(f.calls,2,'retried after 30 seconds');
  f.time(100000+31000+59000);await f.service.status();assert.equal(f.calls,2,'the delay doubled');
  f.fail(false);f.time(100000+31000+61000);const status=await f.service.status();assert.equal(f.calls,3);assert.equal(status.error,null);assert.equal(status.latest?.tag,'v0.3.0');
  f.time(100000+31000+61000+59*60000);await f.service.status();assert.equal(f.calls,3,'success is cached for an hour');
  f.time(100000+31000+61000+61*60000);await f.service.status();assert.equal(f.calls,4);
 }finally{await f.close();}
});
test('task and source checks are only made when an update exists',async()=>{
 const none=await fixture();try{
  none.value(release('v0.2.2'));for(let i=0;i<5;i++)await none.service.status();
  assert.equal(none.busyCalls,0,'idle polling does not touch the task tables');
 }finally{await none.close();}
 const some=await fixture();try{
  await some.service.status();assert.ok(some.busyCalls>0);
 }finally{await some.close();}
});
