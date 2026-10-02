import test from 'node:test';
import assert from 'node:assert/strict';
import {SqliteStore} from '../src/storage.js';
import {OrbitRuntime} from '../src/runtime/index.js';
import {selectNativePrimary,setNativePrimary,visibleNativeDots} from '../src/native-selection.js';
const fixture=()=>{const store=new SqliteStore(':memory:'),runtime=new OrbitRuntime(store,{run:async()=>{throw Error('unused');}});return {store,runtime};};
test('a deleted selection recovers the user profile once and remains stable across test updates',()=>{
 const {store,runtime}=fixture();try{
  const test=runtime.createDot({name:'Acceptance'}),genius=runtime.createDot({name:'Genius',avatarUrl:'file-service://avatar'});
  store.put('native_meta',{id:'primary',dotId:'deleted-legacy',generation:1});
  assert.equal(selectNativePrimary(store,runtime.listDots())?.id,genius.id);
  const selection=store.get('native_meta','primary');runtime.updateDot(test.id,{name:'Updated test'});
  assert.equal(selectNativePrimary(store,runtime.listDots())?.id,genius.id);assert.deepEqual(store.get('native_meta','primary'),selection);
 }finally{store.close();}
});
test('an explicitly selected Dot remains selected while its root is being repaired',()=>{
 const {store,runtime}=fixture();try{
  const selected=runtime.createDot({name:'Selected'}),other=runtime.createDot({name:'Other',avatarUrl:'file-service://other'});
  store.put('dots',{...other,rootThreadId:'ready-thread'});setNativePrimary(store,selected);
  assert.equal(selectNativePrimary(store,runtime.listDots())?.id,selected.id);
  runtime.deleteDot(selected.id);assert.equal(store.get('native_meta','primary'),undefined);
  assert.equal(selectNativePrimary(store,runtime.listDots())?.id,other.id);
 }finally{store.close();}
});
test('archived acceptance profiles are preserved without entering native listing or automatic selection',()=>{
 const {store,runtime}=fixture();try{
  const test=runtime.createDot({name:'Acceptance',avatarUrl:'file-service://test'}),genius=runtime.createDot({name:'Genius'});
  store.put('native_hidden_dots',{id:test.id,reason:'acceptance-test'});setNativePrimary(store,test);
  assert.deepEqual(visibleNativeDots(store,runtime.listDots()).map(d=>d.id),[genius.id]);
  assert.equal(selectNativePrimary(store,runtime.listDots())?.id,genius.id);assert.equal(runtime.getDot(test.id).name,'Acceptance');
 }finally{store.close();}
});
test('inherited model settings are resolved for each new task, including worker tasks',()=>{
 const {store,runtime}=fixture();try{
  let settings={model:'dashboard-first',reasoningEffort:'high',serviceTier:null as string|null};
  const inherited=new OrbitRuntime(store,runtime.runner,{settings:()=>settings});
  const d=inherited.createDot({name:'Genius'});
  const first=inherited.createTask({dotId:d.id,input:'First',computerId:'worker'});assert.equal(first.model,'dashboard-first');assert.equal(first.reasoningEffort,'high');
  settings={model:'dashboard-second',reasoningEffort:'low',serviceTier:'priority'};
  const second=inherited.createTask({dotId:d.id,input:'Second'});assert.equal(second.model,'dashboard-second');assert.equal(second.reasoningEffort,'low');assert.equal(second.serviceTier,'priority');
  inherited.updateDot(d.id,{model:'explicit-dot',reasoningEffort:'medium'});
  const custom=inherited.createTask({dotId:d.id,input:'Custom'});assert.equal(custom.model,'explicit-dot');assert.equal(custom.reasoningEffort,'medium');assert.equal(custom.serviceTier,null);
  assert.equal(inherited.createTask({dotId:d.id,input:'Override',model:'explicit-task'}).model,'explicit-task');
 }finally{store.close();}
});
