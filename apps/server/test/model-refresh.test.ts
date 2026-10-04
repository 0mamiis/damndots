import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderService, MODEL_REFRESH_MS } from '../src/providers.js';
import { SecretVault } from '../src/integrations/security.js';
import { SqliteStore } from '../src/storage.js';

function fixture() {
 const store=new SqliteStore(':memory:');
 let time=Date.now(), ids=['model-a'], failed=false, calls=0, release:(()=>void)|undefined;
 const service=new ProviderService(store,{
  vault:new SecretVault(Buffer.alloc(32,9)),
  fallback:{baseUrl:'http://127.0.0.1:10100/v1',apiKey:''},
  activeId:()=>null, clock:()=>time,
  fetch:async()=>{
   calls++;
   if(release)await new Promise<void>(resolve=>{release=resolve;});
   if(failed)return new Response('{}',{status:503});
   return Response.json({data:ids.map(id=>({id}))});
  },
 });
 return {service,store,setIds:(next:string[])=>ids=next,advance:()=>time+=MODEL_REFRESH_MS,
  fail:(value:boolean)=>failed=value,calls:()=>calls,block:()=>release=()=>{},
  unblock:()=>{const done=release;release=undefined;done?.();}};
}

test('models and provider settings discover additions and removals after the cache expires',async()=>{
 const f=fixture();
 try {
  assert.deepEqual((await f.service.models()).models.map(m=>m.id),['model-a']);
  f.setIds(['model-b']);
  assert.deepEqual((await f.service.models()).models.map(m=>m.id),['model-a']);
  assert.equal(f.calls(),1);
  f.advance();
  const [catalog,providers]=await Promise.all([f.service.models(),f.service.listFresh()]);
  assert.deepEqual(catalog.models.map(m=>m.id),['model-b']);
  assert.deepEqual(providers[0].models.map(m=>m.id),['model-b']);
  assert.equal(f.calls(),2,'both routes share a single upstream fetch');
 }finally{f.store.close();}
});

test('outages keep the last successful catalog, expose errors and throttle retries, including on cold start',async()=>{
 const f=fixture();
 try {
  await f.service.models(); f.advance(); f.fail(true);
  assert.deepEqual((await f.service.models()).models.map(m=>m.id),['model-a']);
  assert.match(f.service.get('default').lastError!,/503/);
  const count=f.calls();
  await f.service.listFresh(); await f.service.models();
  assert.equal(f.calls(),count);
  f.advance(); f.fail(false); f.setIds(['model-c']);
  assert.deepEqual((await f.service.models()).models.map(m=>m.id),['model-c']);
  assert.equal(f.service.get('default').lastError,null);
  const cold=fixture();
  try {
   cold.fail(true);
   assert.deepEqual((await cold.service.models()).models,[]);
   const failures=cold.calls();await cold.service.models();
   assert.equal(cold.calls(),failures,'empty catalogs also get retry backoff');
  }finally{cold.store.close();}
 }finally{f.store.close();}
});

test('manual models survive catalog refresh and explicit refresh bypasses the age limit',async()=>{
 const f=fixture();
 try {
  const custom=await f.service.create({name:'Test',baseUrl:'http://127.0.0.1:10100/v1',apiFormat:'responses',manualModels:['manual']});
  f.setIds(['new-model']);
  const updated=await f.service.refreshModels(custom.id);
  assert.deepEqual(updated.models.map(m=>m.id),['new-model','manual']);
  assert.equal(updated.models[1].manual,true);
  f.service.update(custom.id,{baseUrl:'http://127.0.0.1:10100/other/v1'});
  f.setIds(['other-model']);
  assert.deepEqual((await f.service.models(custom.id)).models.map(m=>m.id),['other-model','manual']);
 }finally{f.store.close();}
});

test('an in-flight refresh cannot resurrect a deleted provider or overwrite a changed endpoint',async()=>{
 const f=fixture();
 try {
  const custom=await f.service.create({name:'Test',baseUrl:'http://127.0.0.1:10100/v1',apiFormat:'responses'});
  f.block(); const pending=f.service.refreshModels(custom.id);
  f.service.remove(custom.id); f.unblock();
  await assert.rejects(pending,/bulunamadı/);
  assert.equal(f.store.get('providers',custom.id),undefined);
  const next=await f.service.create({name:'Next',baseUrl:'http://127.0.0.1:10100/v1',apiFormat:'responses'});
  f.block();const stale=f.service.refreshModels(next.id);
  f.service.update(next.id,{baseUrl:'http://127.0.0.1:10100/changed/v1'});
  f.unblock();await stale;
  assert.equal(f.service.get(next.id).baseUrl,'http://127.0.0.1:10100/changed/v1');
  assert.equal(f.service.get(next.id).modelsFetchedAt,null);
 }finally{f.store.close();}
});

