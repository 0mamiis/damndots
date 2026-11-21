import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import patch from '../windows-updater-patch.cjs';
const require=createRequire(import.meta.url);

test('windows updater patch wraps loader idempotently and fails closed on unknown shapes',()=>{
 const sample='function load(){try{return o((0,i.join)(process.resourcesPath,"native","windows-updater.node"))}catch{return null}}';
 const patched=patch.patchWindowsUpdater(sample);
 assert.match(patched,/__damndotsWrapWindowsUpdater\(o\(\(0,i\.join\)\(process\.resourcesPath,"native","windows-updater\.node"\)\),o\)/);
 assert.equal(patch.patchWindowsUpdater(patched),patched);
 assert.throws(()=>patch.patchWindowsUpdater('function load(){return null}'),/Unsupported/);
});

test('packaged addon passes through unchanged without wrapping',()=>{
 const helper=patch.buildRuntimeHelper();
 const raw={getCurrentPackageFamily:()=>'OpenAI.Codex_2p2nqsd0c76g0',pinPrimaryRuntimePackage:()=>'pinned'};
 const wrapped=vm.runInNewContext(helper+';__damndotsWrapWindowsUpdater(raw,require)',{raw,require,process});
 assert.equal(wrapped,raw);
});

test('unpackaged addon supplies installed Codex identity, cache path, process state and staging fallback',async ()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dots-win-updater-'));
 try{
  const fakeExe=path.join(dir,'ChatGPT.exe');
  fs.writeFileSync(fakeExe,'');
  fs.writeFileSync(path.join(dir,'renewal.json'),JSON.stringify({packageVersion:'26.1117.3838.0'}));
  const fakeMsix=path.join(dir,'prepared.msix');
  fs.writeFileSync(fakeMsix,'msix');
  const raw={
   getCurrentPackageFamily:()=>'',
   getCurrentPackagePublisher:()=>'',
   getPackageLocalCachePath:()=>null,
   isStoreUpdateBlockedByPolicy:()=>{throw Error('Windows updater requires packaged app identity.');},
   stagePackage:async()=>{throw Error('Windows updater requires packaged app identity.');},
   pinPrimaryRuntimePackage:(f)=>('pinned:'+f),
   deployment:{
    registerRestart:()=>{throw Error('unpackaged');},
    readProcessState:()=>{throw Error('Windows updater requires packaged app identity.');}
   }
  };
  const fakeProcess={execPath:fakeExe,env:{...process.env,LOCALAPPDATA:dir},uptime:()=>12};
  const wrapped=vm.runInNewContext(patch.buildRuntimeHelper()+';__damndotsWrapWindowsUpdater(raw,require)',{raw,require,process:fakeProcess});
  assert.notEqual(wrapped,raw);
  assert.equal(wrapped.getCurrentPackageFamily(),patch.DEFAULT_FAMILY);
  assert.equal(wrapped.getCurrentPackagePublisher(),patch.DEFAULT_PUBLISHER);
  assert.equal(wrapped.isStoreUpdateBlockedByPolicy(),false);
  assert.equal(wrapped.pinPrimaryRuntimePackage('rt'),'pinned:rt');
  const cachePath=wrapped.getPackageLocalCachePath();
  assert.ok(cachePath.endsWith(path.join('Packages',patch.DEFAULT_FAMILY,'LocalCache')));
  assert.equal(fs.existsSync(cachePath),true);
  const st=wrapped.deployment.readProcessState();
  assert.equal(st.packageFamilyName,patch.DEFAULT_FAMILY);
  assert.equal(st.packageVersion,'26.1117.3838.0');
  assert.doesNotThrow(()=>wrapped.deployment.registerRestart('--codex-update-attempt=1'));
  await wrapped.stagePackage(fakeMsix);
  await assert.rejects(()=>wrapped.stagePackage(path.join(dir,'missing.msix')),/not found/);
 }finally{
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
