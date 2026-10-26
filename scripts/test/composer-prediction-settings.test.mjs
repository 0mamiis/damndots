import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),preferences=require('../composer-prediction-settings.cjs');
test('prediction settings only accept a boolean and never contain conversation text',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'composer-settings-'));
 try{assert.throws(()=>preferences.validate({enabled:true,prompt:'do something'}));assert.throws(()=>preferences.validate({enabled:'true'}));
 preferences.write(dir,{enabled:false});assert.equal(preferences.read(dir,dir).enabled,false);assert.equal(preferences.read(dir,dir).connected,false);assert.equal(preferences.read(dir,dir).applied,false);
 preferences.write(dir,{enabled:true});assert.equal(preferences.read(dir,dir).enabled,true);
 preferences.write(dir,{enabled:true,model:'gpt-6-luna'});assert.equal(preferences.read(dir,dir).model,'gpt-6-luna');
 preferences.write(dir,{enabled:false});assert.equal(preferences.read(dir,dir).model,'gpt-6-luna');
 preferences.write(dir,{enabled:true,model:null});assert.equal(preferences.read(dir,dir).model,null);
 preferences.write(dir,{enabled:true,model:'gpt-6-luna',effort:'high',fast:true});const state=preferences.read(dir,dir);assert.equal(state.effort,'high');assert.equal(state.fast,true);assert.throws(()=>preferences.validate({enabled:true,effort:'invalid'}));assert.throws(()=>preferences.validate({enabled:true,fast:'yes'}));
 assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir,'composer-predictions.json')))).sort(),['effort','enabled','fast','model','revision']);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('an installed manifest alone cannot report a live applied native setting',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'composer-settings-'));
 try{fs.writeFileSync(path.join(dir,'composer-predictions-patch.json'),'{"version":1}');const s=preferences.read(dir,dir);assert.equal(s.enabled,false);assert.equal(s.installed,true);assert.equal(s.connected,false);assert.equal(s.applied,false);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('a transient Windows file lock does not lose a settings change',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'composer-settings-')),rename=fs.renameSync;let attempts=0;
 try{fs.renameSync=(...args)=>{if(attempts++===0)throw Object.assign(new Error('temporarily locked'),{code:'EPERM'});return rename(...args);};preferences.write(dir,{enabled:true,model:'gpt-6-luna'});assert.equal(attempts,2);assert.equal(preferences.read(dir,dir).model,'gpt-6-luna');}
 finally{fs.renameSync=rename;fs.rmSync(dir,{recursive:true,force:true});}
});
