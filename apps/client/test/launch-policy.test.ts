import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,utimes,stat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {launchAction,acquireLaunchLock} from '../src/launch-policy.js';
test('manual launch reuses a running window; only a healthy Dots service changes the launch route',()=>{
  assert.equal(launchAction(true,true),'focus');assert.equal(launchAction(true,false),'focus');
  assert.equal(launchAction(false,true),'dots');assert.equal(launchAction(false,false),'installed');
});

test('empty and incomplete locks from a closed console are recovered',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dots-orphan-lock-')),lock=join(dir,'lock');
  try{
    for(const contents of [undefined,'{',JSON.stringify({pid:0})]){
      await mkdir(lock);if(contents!==undefined)await writeFile(join(lock,'owner.json'),contents);
      const old=new Date(Date.now()-5000);await utimes(lock,old,old);
      const recovered=await acquireLaunchLock(lock);assert.ok(recovered);await recovered();
      await assert.rejects(stat(lock),{code:'ENOENT'});
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('process exit removes the entire lock, not just owner.json',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dots-exit-lock-')),lock=join(dir,'lock');
  try{
    const module=new URL('../src/launch-policy.ts',import.meta.url).href;
    const code=`import {acquireLaunchLock} from ${JSON.stringify(module)};const release=await acquireLaunchLock(${JSON.stringify(lock)});if(!release)throw Error('lock busy');process.once('exit',()=>{void release();});`;
    await promisify(execFile)(process.execPath,['--import','tsx','--input-type=module','-e',code],{windowsHide:true});
    await assert.rejects(stat(lock),{code:'ENOENT'});
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('concurrent manual launches cannot acquire the same lock; a crashed owner is recovered',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dots-launch-')),lock=join(dir,'lock');
  try{
    const first=await acquireLaunchLock(lock);assert.ok(first);
    assert.equal(await acquireLaunchLock(lock),undefined);await first();
    await mkdir(lock);await writeFile(join(lock,'owner.json'),JSON.stringify({pid:2147483647}));
    const recovered=await acquireLaunchLock(lock);assert.ok(recovered);await recovered();
  }finally{await rm(dir,{recursive:true,force:true});}
});
