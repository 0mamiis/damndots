import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ensureFeatures,prunePrevious,pruneBaseline,discardFailedStaging,SUPPORTED} from '../desktop-feature-manager.mjs';

function tmp(){return fs.mkdtempSync(path.join(os.tmpdir(),'feature-copy-'));}
function mk(dir,rel,body='x'){const f=path.join(dir,rel);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,body);}

test('prunePrevious keeps only the newest previous-* and never touches app or staging',()=>{
 const d=tmp();try{
  for(const n of ['app','staging','previous-100','previous-300','previous-200'])mk(d,n+'/f.txt');
  prunePrevious(d);
  assert.deepEqual(fs.readdirSync(d).sort(),['app','previous-300','staging']);
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});

test('pruneBaseline removes an old-version baseline and keeps the current one',()=>{
 const d=tmp();try{
  mk(d,'baseline/manifest.json',JSON.stringify({packageVersion:'1.0'}));
  assert.equal(pruneBaseline(d,'2.0'),true);assert.equal(fs.existsSync(path.join(d,'baseline')),false);
  mk(d,'baseline/manifest.json',JSON.stringify({packageVersion:'2.0'}));
  assert.equal(pruneBaseline(d,'2.0'),false);assert.equal(fs.existsSync(path.join(d,'baseline')),true);
  assert.equal(pruneBaseline(d,'2.0',{force:true}),true);assert.equal(fs.existsSync(path.join(d,'baseline')),false);
  assert.equal(pruneBaseline(d,'2.0'),false);
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});

test('deletion failures never throw',()=>{
 const d=tmp();try{
  mk(d,'staging/f.txt');mk(d,'baseline/manifest.json','{}');mk(d,'previous-1/f');mk(d,'previous-2/f');
  const m=mock.method(fs,'rmSync',()=>{throw Object.assign(Error('locked'),{code:'EPERM'});});
  try{
   assert.equal(discardFailedStaging(d),false);
   assert.equal(pruneBaseline(d,'2.0'),false);
   assert.doesNotThrow(()=>prunePrevious(d));
  }finally{m.mock.restore();}
  assert.ok(fs.existsSync(path.join(d,'staging')));
 }finally{fs.rmSync(d,{recursive:true,force:true});}
});

test('failed build removes staging, keeps app, records failed; stale copies pruned at start',()=>{
 const native=tmp();try{
  const dir=path.join(native,'desktop-features');
  mk(dir,'app/ChatGPT.exe','keep');mk(dir,'previous-1/f');mk(dir,'previous-2/f');
  mk(dir,'baseline/manifest.json',JSON.stringify({packageVersion:'0.0.old'}));
  const version=SUPPORTED[SUPPORTED.length-1];
  assert.throws(()=>ensureFeatures({nativeDir:native,includeLocalPatches:false,sourcePackage:{version,root:path.join(native,'missing-source')}}));
  assert.equal(fs.existsSync(path.join(dir,'staging')),false);
  assert.equal(fs.readFileSync(path.join(dir,'app/ChatGPT.exe'),'utf8'),'keep');
  assert.equal(fs.existsSync(path.join(dir,'previous-1')),false);
  assert.equal(fs.existsSync(path.join(dir,'previous-2')),true);
  assert.equal(fs.existsSync(path.join(dir,'baseline')),false);
  const st=JSON.parse(fs.readFileSync(path.join(dir,'status.json'),'utf8'));
  assert.equal(st.state,'failed');assert.ok(st.error);assert.equal(st.staging,undefined);
 }finally{fs.rmSync(native,{recursive:true,force:true});}
});

function setup(){const native=tmp();const dir=path.join(native,'desktop-features');mk(dir,'app/ChatGPT.exe','keep');mk(dir,'app/other.dll','keep');return {native,dir,version:SUPPORTED[SUPPORTED.length-1]};}
const good=staging=>{mk(staging,'ChatGPT.exe','new');return {checked:0};};
function run(native,version,testBuild){return ()=>ensureFeatures({nativeDir:native,includeLocalPatches:false,sourcePackage:{version,root:path.join(native,'src')},testBuild});}

test('build failure before the swap removes staging and keeps app',()=>{
 const {native,dir,version}=setup();try{
  assert.throws(run(native,version,s=>{mk(s,'partial.bin');throw Error('patch failed');}),/patch failed/);
  assert.equal(fs.existsSync(path.join(dir,'staging')),false);
  assert.equal(fs.readFileSync(path.join(dir,'app/ChatGPT.exe'),'utf8'),'keep');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'status.json'),'utf8')).state,'failed');
 }finally{fs.rmSync(native,{recursive:true,force:true});}
});

test('swap failure moving app keeps finished staging and app, records staging',()=>{
 const {native,dir,version}=setup();const app=path.join(dir,'app');
 const real=fs.renameSync;const m=mock.method(fs,'renameSync',(a,b)=>{if(path.resolve(String(a))===app)throw Object.assign(Error('locked'),{code:'EPERM'});return real(a,b);});
 try{
  assert.throws(run(native,version,good),/locked/);
 }finally{m.mock.restore();}
 try{
  assert.equal(fs.readFileSync(path.join(dir,'staging/ChatGPT.exe'),'utf8'),'new');
  assert.equal(fs.readFileSync(path.join(dir,'app/other.dll'),'utf8'),'keep');
  const st=JSON.parse(fs.readFileSync(path.join(dir,'status.json'),'utf8'));
  assert.equal(st.state,'failed');assert.equal(st.staging,path.join(dir,'staging'));
 }finally{fs.rmSync(native,{recursive:true,force:true});}
});

test('swap failure installing staging keeps the finished staging',()=>{
 const {native,dir,version}=setup();const staging=path.join(dir,'staging');
 const real=fs.renameSync;const m=mock.method(fs,'renameSync',(a,b)=>{if(path.resolve(String(a))===staging)throw Object.assign(Error('locked'),{code:'EPERM'});return real(a,b);});
 try{
  assert.throws(run(native,version,good),/locked/);
 }finally{m.mock.restore();}
 try{
  assert.equal(fs.readFileSync(path.join(staging,'ChatGPT.exe'),'utf8'),'new');
  assert.ok(fs.readdirSync(dir).some(n=>/^previous-\d+$/.test(n)));
 }finally{fs.rmSync(native,{recursive:true,force:true});}
});
