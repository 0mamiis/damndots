import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';

test('native controller applies prediction settings without changing the conversation model',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dots-prediction-runtime-'));let setting=true,tick,stopped=false,clears=0;
 const context=vm.createContext({require:createRequire(import.meta.url),process:{env:{DAMNDOTS_PREDICTION_TEST_DIR:dir},pid:process.pid,execPath:process.execPath},setInterval:f=>{tick=f;return{unref(){}};},clearInterval:()=>{stopped=true;},Date,JSON,Promise});
 try{
  vm.runInContext(fs.readFileSync(new URL('../native-prediction-preferences.js',import.meta.url),'utf8'),context);
  const controller={clear(){clears++;},settings:{getEffective:k=>{assert.equal(k,'composer-predictions-enabled');return setting;},set:async(k,v)=>{assert.equal(k,'composer-predictions-enabled');setting=v;}},getConfig:async()=>({is_enabled:true,prediction_reasoning_effort:'low'}),getInferenceOptions:()=>({useThreadSample:true})};
  const stop=context.damndotsConnectComposerPredictions(controller);await new Promise(resolve=>setImmediate(resolve));
  fs.writeFileSync(path.join(dir,'composer-predictions.json'),JSON.stringify({enabled:false,model:'gpt-6-luna',effort:'max',fast:true,revision:1}));tick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(setting,false);const config=await controller.getConfig();assert.equal(config.damndotsPredictionModel,'gpt-6-luna');assert.equal(config.prediction_reasoning_effort,'max');assert.equal(config.damndotsPredictionFast,true);assert.equal(controller.getInferenceOptions().disableMcp,true);
  fs.writeFileSync(path.join(dir,'composer-predictions.json'),JSON.stringify({enabled:true,model:null,effort:null,fast:false,revision:2}));tick();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(setting,true);assert.equal((await controller.getConfig()).damndotsPredictionModel,null);assert.equal(clears,2);stop();assert.equal(stopped,true);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
