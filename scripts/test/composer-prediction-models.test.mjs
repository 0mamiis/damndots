import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const {activeModels}=createRequire(import.meta.url)('../composer-prediction-models.cjs');
test('only explicitly active OpenCodex rows are returned in picker order with exact routing ids',()=>{
 const rows=[{namespaced:'p/disabled',disabled:true},{namespaced:'p/unknown'},{namespaced:'p/a',provider:'p',id:'a',disabled:false,reasoningEfforts:['high']},{namespaced:'gpt-6-luna',disabled:false,reasoningEfforts:['low']}];
 const result=activeModels(rows,{modelPickerOrder:['gpt-6-luna','p/a'],providers:{p:{modelDisplayNames:{a:'Model A'}}}});
 assert.deepEqual(result.map(m=>m.id),['gpt-6-luna','p/a']);assert.equal(result[1].label,'Model A');assert.deepEqual(result[1].efforts,['high']);assert.equal(result[0].fast,true);
});
