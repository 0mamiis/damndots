import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
// The scripts run on import, so the helper is extracted from source (the line after the rotate-helper marker).
const load=(file,deps)=>{const src=fs.readFileSync(path.join(dir,'..',file),'utf8').split(/\r?\n/);
 const line=src[src.findIndex(l=>l.startsWith('// rotate-helper'))+1];
 return new Function(...Object.keys(deps),line+';return rotateLog;')(...Object.values(deps));};
const helpers={'detach.mjs':load('detach.mjs',{statSync:fs.statSync,renameSync:fs.renameSync}),
 'apply-pending-features.mjs':load('apply-pending-features.mjs',{fs})};
for(const [name,rotateLog] of Object.entries(helpers)){
 test('rotateLog in '+name,()=>{
  const d=fs.mkdtempSync(path.join(os.tmpdir(),'logrot-'));
  try{
   const f=path.join(d,'a.log');
   rotateLog(f,10); assert.equal(fs.existsSync(f),false);
   fs.writeFileSync(f,'12345');rotateLog(f,10);
   assert.equal(fs.readFileSync(f,'utf8'),'12345');assert.equal(fs.existsSync(f+'.1'),false);
   fs.writeFileSync(f,'x'.repeat(20));rotateLog(f,10);
   assert.equal(fs.existsSync(f),false);assert.equal(fs.readFileSync(f+'.1','utf8'),'x'.repeat(20));
   fs.writeFileSync(f,'y'.repeat(30));rotateLog(f,10);
   assert.equal(fs.readFileSync(f+'.1','utf8'),'y'.repeat(30));
   fs.rmSync(f+'.1');fs.mkdirSync(f+'.1');fs.writeFileSync(path.join(f+'.1','k'),'k');
   fs.writeFileSync(f,'z'.repeat(30));
   assert.doesNotThrow(()=>rotateLog(f,10));assert.equal(fs.readFileSync(f,'utf8'),'z'.repeat(30));
  }finally{fs.rmSync(d,{recursive:true,force:true});}
 });
}
test('detach.mjs rotates an oversized log once at open',()=>{
 const d=fs.mkdtempSync(path.join(os.tmpdir(),'logrot-'));
 try{
  const f=path.join(d,'x.log');fs.writeFileSync(f,Buffer.alloc(5*1024*1024+1));
  const r=spawnSync(process.execPath,[path.join(dir,'..','detach.mjs'),f,os.tmpdir(),process.execPath,'-e','console.log("hi")'],{encoding:'utf8'});
  assert.equal(r.status,0);
  assert.equal(fs.statSync(f+'.1').size,5*1024*1024+1);
  const end=Date.now()+5000;while(Date.now()<end&&!fs.existsSync(f))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);
  assert.ok(fs.statSync(f).size<100);
 }finally{fs.rmSync(d,{recursive:true,force:true,maxRetries:20,retryDelay:200});}
});
