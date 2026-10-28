import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),settings=require('../orchestrator-settings.cjs');
test('orchestrator settings validate roles, models and priority support',()=>{
 for(const patch of [{...settings.defaults,mode:'unknown'},{...settings.defaults,fast:true,model:'gemini'},{...settings.defaults,effort:'bad'},{...settings.defaults,path:'secret'}])assert.throws(()=>settings.validate(patch));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dots-orch-'));
 try{settings.write(dir,{mode:'lead',model:'gpt-6.1-sol',effort:'high',fast:true});const state=settings.read(dir,dir);assert.equal(state.mode,'lead');assert.equal(state.fast,true);assert.equal(state.applied,false);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('renderer refresh applies defaults without altering per-chat or explicit model storage',async()=>{
 let callback,events=0;const storage=new Map([['codex-orchestrator-thread-modes-v2','{"existing":"off"}']]);
 const context=vm.createContext({window:{electronBridge:{getOrchestratorPreferences:async()=>({mode:'lead',model:null,effort:null,fast:false})},dispatchEvent:()=>events++},document:{visibilityState:'visible'},localStorage:{getItem:k=>storage.get(k),setItem:()=>assert.fail('poll must not alter local selections')},Event:class{},setInterval:fn=>{callback=fn;return 1;},clearInterval(){},JSON});
 vm.runInContext(fs.readFileSync(new URL('../orchestrator-renderer.js',import.meta.url),'utf8'),context);const stop=context.damndotsWatchOrchestratorPreferences();await new Promise(r=>setImmediate(r));assert.equal(context.damndotsOrchestratorPreferences.mode,'lead');assert.equal(context.window.__damndotsOrchestratorDefaults.mode,'lead');assert.equal(events,1);await callback();assert.equal(events,1);assert.equal(storage.get('codex-orchestrator-thread-modes-v2'),'{"existing":"off"}');stop();
});
