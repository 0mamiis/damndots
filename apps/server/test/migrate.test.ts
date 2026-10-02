import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {SqliteStore} from '../src/storage.js';import {BlobStore} from '../src/blobs.js';import {importLegacy} from '../src/migrate.js';
test('legacy orbit data imports dots, avatars, messages and thread aliases exactly once, without touching the source',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dots-legacy-')),target=await mkdtemp(join(tmpdir(),'dots-target-'));try{
  await mkdir(join(root,'data/avatars'),{recursive:true});const png=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');await writeFile(join(root,'data/avatars/file_abc.png'),png);
  const tbo={id:'tbo_legacy',display_name:'Eski dot',status:'active',is_paused:false,root_thread_id:'thread-root',thread_ids:['thread-root','thread-old'],messaging_room_id:'room_legacy',avatar_url:'file-service://file_abc',avatar_manifest:{snapshot:{schema_version:1,asset_pointer:'file-service://file_abc'}},created_at:'2026-09-30T10:00:00.000Z',updated_at:'2026-09-30T10:05:00.000Z'};
  await writeFile(join(root,'data/orbit-store.json'),JSON.stringify({tbos:[tbo],primaryTboId:'tbo_legacy',primaryGeneration:3}));
  await writeFile(join(root,'data/messages.json'),JSON.stringify({room_legacy:[{id:'m1',content:{text:'merhaba'},request_id:'r1',created_at:'2026-09-30T10:01:00.000Z'},{id:'m2',raw_messages:[{author:{role:'assistant'},content:{parts:['selam']}}],created_at:'2026-09-30T10:02:00.000Z'}]}));
  const store=new SqliteStore(':memory:'),blobs=new BlobStore(join(target,'files'),store);
  const first=await importLegacy(root,store,blobs);assert.deepEqual({...first},{dots:1,messages:2,avatars:1,alreadyImported:false});
  const dot=store.get<any>('dots','tbo_legacy');assert.equal(dot.name,'Eski dot');assert.equal(dot.rootThreadId,'thread-root');assert.match(dot.avatarUrl,/^file-service:\/\/file_/);assert.notEqual(dot.avatarUrl,'file-service://file_abc');
  assert.equal(store.get<any>('native_thread_aliases','thread-old').dotId,'tbo_legacy');assert.equal(store.get<any>('native_meta','primary').dotId,'tbo_legacy');
  const messages=store.list<any>('messages');assert.deepEqual(messages.map(m=>[m.role,m.text]).sort(),[['assistant','selam'],['user','merhaba']]);
  assert.ok((await blobs.read(dot.avatarUrl.slice('file-service://'.length))).equals(png));
  const again=await importLegacy(root,store,blobs);assert.equal(again.alreadyImported,true);assert.equal(store.list<any>('dots').length,1);assert.equal(store.list<any>('messages').length,2);
  await assert.rejects(importLegacy(join(root,'missing'),store,blobs));store.close();
 }finally{await rm(root,{recursive:true,force:true});await rm(target,{recursive:true,force:true});}
});
