import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),settings=require('../token-speed-settings.cjs');
test('strict token speed preferences round trip without allowing file paths or invalid values',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dots-tps-'));
 try{for(const patch of [{...settings.defaults,decimals:3},{...settings.defaults,enabled:'true'},{...settings.defaults,path:'secret'},{...settings.defaults,aggregation:'bad'}])assert.throws(()=>settings.validate(patch));
 settings.write(dir,{enabled:false,aggregation:'latest',decimals:2,animate:false});const state=settings.read(dir,dir);assert.equal(state.enabled,false);assert.equal(state.aggregation,'latest');assert.equal(state.decimals,2);assert.equal(state.applied,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('renderer settings refresh once per poll and stops after unmount',async()=>{
 let callback,stopped=false,events=0,calls=0;const preferences={enabled:false,aggregation:'latest',decimals:1,animate:false};
 const context=vm.createContext({window:{electronBridge:{getTokenSpeedPreferences:async()=>{calls++;return preferences;}},dispatchEvent:()=>events++},document:{visibilityState:'visible'},Event:class{},setInterval:fn=>{callback=fn;return 1;},clearInterval:()=>{stopped=true;},JSON});
 vm.runInContext(fs.readFileSync(new URL('../token-speed-renderer.js',import.meta.url),'utf8'),context);
 const stop=context.damndotsWatchTpsPreferences();await new Promise(r=>setImmediate(r));assert.equal(context.damndotsTpsPreferences.enabled,false);assert.equal(events,1);await callback();assert.equal(events,1);stop();await callback();assert.equal(calls,2);assert.equal(stopped,true);
});
test('native preference IPC rejects untrusted frames and only returns allowlisted settings',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dots-tps-ipc-'));let handler;
 const nativeRequire=id=>id==='electron'?{ipcMain:{handle:(_name,fn)=>handler=fn}}:id==='node:os'?{homedir:()=>dir}:require(id);
 const context=vm.createContext({require:nativeRequire,process:{pid:process.pid},Date,JSON});
 try{vm.runInContext(fs.readFileSync(new URL('../token-speed-runtime.js',import.meta.url),'utf8'),context);assert.equal(handler({senderFrame:{url:'https://evil.example/'}}),null);const result=handler({senderFrame:{url:'app://-/index.html'}});assert.deepEqual(Object.keys(result).sort(),['aggregation','animate','decimals','enabled']);assert.equal(result.enabled,true);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
