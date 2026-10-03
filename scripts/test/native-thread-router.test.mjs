import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeThreadRegistry} from '../native-thread-router.mjs';

test('cached old root still routes to Dots after a root migration and desktop restart',async()=>{
 const calls=[];
 const registry=new NativeThreadRegistry(async path=>{
  calls.push(path);
  if(path==='/backend-api/tbo')return {items:[{id:'null',root_thread_id:'new-root',active_root_thread_id:'new-root'}]};
  if(path==='/backend-api/tbo/null/threads')return {items:[{thread_id:'old-root'},{thread_id:'new-root'}]};
  throw Error('Unexpected ownership fallback');
 });
 assert.equal(await registry.owns('old-root'),true);
 assert.equal(registry.has('new-root'),true);
 assert.deepEqual(calls,['/backend-api/tbo','/backend-api/tbo/null/threads']);
});

test('a just-migrated root is resolved by persisted ownership even before the history refresh',async()=>{
 let now=100,calls=0;
 const registry=new NativeThreadRegistry(async path=>{
  if(path==='/backend-api/tbo')return {items:[{id:'null',root_thread_id:'root'}]};
  if(path==='/backend-api/tbo/null/threads')return {items:[{thread_id:'root'}]};
  if(path==='/backend-api/tbo/by-thread/migrated'){calls++;return {id:'null',root_thread_id:'migrated'};}
  throw Object.assign(Error('Not found'),{statusCode:404});
 },{clock:()=>now});
 await registry.refresh();
 assert.equal(await registry.owns('migrated'),true);
 assert.equal(await registry.owns('migrated'),true);
 assert.equal(calls,1);
});

test('ordinary local chat stays local and transient outages are not cached as negative ownership',async()=>{
 let lookups=0,fail=true,now=0;
 const registry=new NativeThreadRegistry(async path=>{
  if(path==='/backend-api/tbo')return {items:[]};
  lookups++;
  if(path.endsWith('/transient')&&fail)throw Object.assign(Error('Unavailable'),{statusCode:502});
  if(path.endsWith('/transient'))return {id:'null',root_thread_id:'transient'};
  throw Object.assign(Error('Not found'),{statusCode:404});
 },{clock:()=>now});
 assert.equal(await registry.owns('normal-local'),false);
 assert.equal(await registry.owns('normal-local'),false);
 assert.equal(lookups,1);
 await assert.rejects(registry.owns('transient'),/Unavailable/);
 fail=false;
 assert.equal(await registry.owns('transient'),true);
 now=6000;
 assert.equal(await registry.owns('normal-local'),false);
 assert.equal(lookups,4);
});

test('concurrent requests for a proven alias share one ownership lookup',async()=>{
 let calls=0;
 const registry=new NativeThreadRegistry(async path=>{
  if(path==='/backend-api/tbo')return {items:[]};
  calls++;await new Promise(r=>setTimeout(r,5));return {id:'null',root_thread_id:'actual'};
 });
 assert.deepEqual(await Promise.all([registry.owns('alias'),registry.owns('alias')]),[true,true]);
 assert.equal(calls,1);
});

