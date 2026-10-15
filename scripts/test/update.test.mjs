import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {performUpdate,verifyCheckout,validateJob,needsInstall} from '../update.mjs';
import {execFileSync,spawn} from 'node:child_process';
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

test('dependency reinstall is only needed when a package definition changed', () => {
  assert.equal(needsInstall(['apps/server/src/app.ts', 'docs/UPDATES.md']), false);
  assert.equal(needsInstall(['apps/server/src/app.ts', 'package-lock.json']), true);
  assert.equal(needsInstall(['apps/dashboard/package.json']), true);
  assert.equal(needsInstall(['scripts/package.json.md', 'apps/x/not-package.json.ts']), false);
  assert.equal(needsInstall(undefined), true, 'unknown means reinstall');
});
test('a detached updater survives the services that started it being stopped as a process tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dots-detach-')), pidFile = join(root, 'updater.pid');
  const detach = join(process.cwd(), 'scripts/detach.mjs');
  await writeFile(join(root, 'updater.cjs'), "require('fs').writeFileSync(process.argv[2],String(process.pid));setInterval(()=>{},1000);");
  await writeFile(join(root, 'service.cjs'), "const {spawnSync}=require('child_process');const r=spawnSync(process.execPath,[process.argv[2],process.argv[3],process.argv[4],process.execPath,process.argv[5],process.argv[6]],{stdio:'ignore'});require('fs').writeFileSync(process.argv[7],String(r.status));setInterval(()=>{},1000);");
  const status = join(root, 'launcher.status');
  const service = spawn(process.execPath, [join(root, 'service.cjs'), detach, join(root, 'update.log'), root, join(root, 'updater.cjs'), pidFile, status], { stdio: 'ignore', windowsHide: true });
  let updater = 0;
  try {
    for (let i = 0; i < 100 && !updater; i++) { try { updater = Number(await readFile(pidFile, 'utf8')); } catch { await new Promise(r => setTimeout(r, 100)); } }
    assert.ok(updater > 0, 'the updater started');
    assert.equal(await readFile(status, 'utf8'), '0', 'the launcher reports success');
    if (process.platform === 'win32') execFileSync('taskkill.exe', ['/PID', String(service.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); else service.kill('SIGKILL');
    await new Promise(r => setTimeout(r, 700));
    assert.doesNotThrow(() => process.kill(updater, 0), 'the updater is still running');
  } finally { try { if (updater) process.kill(updater); } catch {} service.kill(); await new Promise(r => setTimeout(r, 300)); await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
});
