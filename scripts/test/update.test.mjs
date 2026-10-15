import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {performUpdate,verifyCheckout,validateJob} from '../update.mjs';
import {execFileSync} from 'node:child_process';
test('rollback leaves source, settings and user files intact after a failed replacement health check',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dots-real-rollback-')),jobFile=join(root,'job.json');
 await writeFile(jobFile,JSON.stringify({id:'recovery',target:'v0.3.0',status:'preparing'}));
 await writeFile(join(root,'source.txt'),'old code');await writeFile(join(root,'.env'),'KEEP=private');await writeFile(join(root,'workspace.txt'),'user work');
 let checks=0,restarts=0;
 try{
   await assert.rejects(performUpdate({root,jobFile,
     prepare:async()=>{assert.equal(await readFile(join(root,'source.txt'),'utf8'),'old code');},
     stop:async()=>{},
     install:async()=>{await writeFile(join(root,'source.txt'),'new code');},
     restart:async()=>{restarts++;},
     health:async()=>{if(checks++===0)throw Error('replacement unhealthy');},
     rollback:async()=>{await writeFile(join(root,'source.txt'),'old code');}
   }));
   assert.equal(JSON.parse(await readFile(jobFile,'utf8')).status,'rolled_back');
   assert.equal(await readFile(join(root,'source.txt'),'utf8'),'old code');
   assert.equal(await readFile(join(root,'.env'),'utf8'),'KEEP=private');
   assert.equal(await readFile(join(root,'workspace.txt'),'utf8'),'user work');
   assert.equal(restarts,2);
 }finally{await rm(root,{recursive:true,force:true});}
});
async function scenario(failure){
 const root=await mkdtemp(join(tmpdir(),'dots-installer-')),jobFile=join(root,'job.json'),calls=[];
 await writeFile(jobFile,JSON.stringify({id:'test',target:'v0.3.0',status:'preparing'}));await writeFile(join(root,'update.lock'),'test');
 const action=name=>async()=>{calls.push(name);if(name===failure)throw Error('Controlled failure');};
 try {
  const result=performUpdate({root,jobFile,prepare:action('prepare'),stop:action('stop'),install:action('install'),restart:action('restart'),health:action('health'),rollback:action('rollback')});
  if(failure)await assert.rejects(result);else await result;
  const job=JSON.parse(await readFile(jobFile,'utf8'));await assert.rejects(readFile(join(root,'update.lock')),{code:'ENOENT'});
  return {calls,job};
 }finally{await rm(root,{recursive:true,force:true});}
}
test('update stages and builds first, stops only then, installs, restarts and health checks',async()=>{
 const {calls,job}=await scenario();assert.deepEqual(calls,['prepare','stop','install','restart','health']);assert.equal(job.status,'completed');
});
test('preparation failure leaves the running installation alone',async()=>{
 const {calls,job}=await scenario('prepare');assert.deepEqual(calls,['prepare']);assert.equal(job.status,'failed');
});
test('installation failure restores the old version before restarting',async()=>{
 const {calls,job}=await scenario('install');assert.deepEqual(calls,['prepare','stop','install','rollback','restart','health']);assert.equal(job.status,'rolled_back');
});
test('failed health check attempts rollback instead of claiming success',async()=>{
 const {calls,job}=await scenario('health');assert.ok(calls.includes('rollback'));assert.equal(job.status,'failed');
});
test('updater refuses a custom repository and dirty source before any download',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dots-source-check-'));try{
  const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'ignore'});
  git('init');git('config','user.email','test@example.com');git('config','user.name','Test');await writeFile(join(root,'source.txt'),'original');git('add','.');git('commit','-m','initial');git('remote','add','origin','https://evil.example.com');
  await assert.rejects(verifyCheckout(root),/origin/);
  git('remote','set-url','origin','https://github.com/0mamiis/damndots.git');await verifyCheckout(root);
  await writeFile(join(root,'source.txt'),'local changes');await assert.rejects(verifyCheckout(root),/Local source/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('job tag and process validation reject command injection and unintended paths',()=>{
 for(const target of ['v1.0.0; whoami','--help','v1.0.0/../../other'])assert.throws(()=>validateJob({id:'abc',target,stackPid:1},'/tmp/job.json','/tmp'));
});
