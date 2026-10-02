import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../src/app.js';
import { SqliteStore } from '../src/storage.js';
import type { TaskRunner } from '@dots/contracts';

async function fixture(runner:TaskRunner){const dir=await mkdtemp(join(tmpdir(),'dots-avatar-')),store=new SqliteStore(':memory:');const config={host:'127.0.0.1',port:0,dataDir:dir,adminKey:'private-test-key',signingKey:Buffer.alloc(32,1),modelBaseUrl:'http://localhost:10100/v1',modelApiKey:'',appServerUrl:'ws://localhost:9912',model:null,reasoningEffort:'high',serviceTier:null,workerOnlineMs:45000};const services=await buildServer({config,store,runner});await services.app.ready();const login=await services.app.inject({method:'POST',url:'/api/v1/session',payload:{token:config.adminKey}}),access=login.json().accessToken;const request=(method:any,url:string,payload?:any,token=access)=>services.app.inject({method,url:'/api/v1'+url,headers:{authorization:'Bearer '+token},...payload!==undefined?{payload}:{}});return {...services,dir,request,cleanup:async()=>{await services.app.close();await rm(dir,{recursive:true,force:true});}};}

test('profile and chat room describe a changed or removed icon identically, so the app cache never flips back',async()=>{
  const f=await fixture({run:async()=>{throw new Error('No task expected');}});
  try {
    const token=f.auth.nativeTokens('avatar-client').access_token,headers={authorization:'Bearer '+token};
    const dot=(await f.request('POST','/dots',{name:'Genius'})).json(),created={id:dot.id,messaging_room_id:dot.messagingRoomId};
    const id=created.id,room=async()=>{const r=(await f.app.inject({method:'GET',url:'/backend-api/messaging/rooms/'+created.messaging_room_id,headers})).json();return r.members.find((m:any)=>m.aeon_id===id);};
    const manifest={schema_version:1,resource_bundle_id:'bundle',appearance:{schemaVersion:3,shape:'circle',color:'gray'},snapshot:{schema_version:1,asset_pointer:'file-service://file_new'}};
    const saved=await f.app.inject({method:'PATCH',url:'/backend-api/tbo/'+id,headers,payload:{display_name:'Yeni ad',avatar_type:'rendered-interactive',avatar_manifest:manifest}});
    assert.equal(saved.statusCode,200);
    const profile=saved.json(),member=await room();
    assert.equal(profile.display_name,'Yeni ad');assert.equal(member.name,'Yeni ad');
    for(const key of ['avatar_type','avatar_url','avatar_manifest']) assert.deepEqual(member[key],profile[key],key);
    assert.equal(member.avatar_url,'file-service://file_new');assert.equal(member.avatar_type,'rendered-interactive');
    // Mascot icons are reported as their own type, matching what the editor sent.
    const pet=await f.app.inject({method:'PATCH',url:'/backend-api/tbo/'+id,headers,payload:{avatar_type:'codex-pet',avatar_url:'file-service://pet',avatar_manifest:{pet_id:'p1',snapshot:{schema_version:1,asset_pointer:'file-service://pet'}}}});
    assert.equal(pet.json().avatar_type,'codex-pet');assert.equal((await room()).avatar_type,'codex-pet');assert.equal(pet.json().display_name,'Yeni ad');
    // Removing the icon clears the image as well as the manifest.
    const removed=await f.app.inject({method:'PATCH',url:'/backend-api/tbo/'+id,headers,payload:{avatar_type:'default',avatar_manifest:null}});
    assert.equal(removed.json().avatar_type,'default');assert.equal(removed.json().avatar_url,null);
    const after=await room();assert.equal(after.avatar_type,'default');assert.equal(after.avatar_url,null);assert.equal(after.avatar_manifest,null);
  } finally {await f.cleanup();}
});

test('copied native profiles resolve cached Dot, room and root IDs without changing an unrelated Dot',async()=>{
 const f=await fixture({run:async()=>{throw new Error('No task expected');}});
 try{
  const native=f.auth.nativeTokens('copy-client').access_token,headers={authorization:'Bearer '+native};
  const dot=(await f.request('POST','/dots',{name:'Null',avatarUrl:'file-service://file_abcd',avatarManifest:{pet_id:'null-signal'}})).json();
  const other=(await f.request('POST','/dots',{name:'Other'})).json();
  const link=await f.request('POST','/dots/'+dot.id+'/native-aliases',{dotId:'old-dot',threadId:'old-root',roomId:'old-room'});
  assert.equal(link.statusCode,200);
  const profile=await f.app.inject({method:'GET',url:'/backend-api/tbo/old-dot',headers});
  assert.equal(profile.statusCode,200);assert.equal(profile.json().id,dot.id);assert.equal(profile.json().avatar_type,'codex-pet');
  const room=await f.app.inject({method:'GET',url:'/backend-api/messaging/rooms/old-room',headers});
  assert.equal(room.statusCode,200);assert.equal(room.json().id,dot.messagingRoomId);assert.equal(room.json().aeon_id,dot.id);
  const root=await f.app.inject({method:'GET',url:'/backend-api/tbo/by-thread/old-root',headers});
  assert.equal(root.statusCode,200);assert.equal(root.json().id,dot.id);
  assert.equal((await f.app.inject({method:'GET',url:'/backend-api/tbo/old-dot'})).statusCode,401);
  assert.equal((await f.request('POST','/dots/'+dot.id+'/native-aliases',{dotId:other.id})).statusCode,409);
  assert.equal((await f.request('POST','/dots/'+other.id+'/native-aliases',{dotId:'old-dot',roomId:'unused-room'})).statusCode,409);
  assert.equal(f.store.get('native_room_aliases','unused-room'),undefined,'failed alias registration is atomic');
 }finally{await f.cleanup();}
});
test('avatar export serves only assets explicitly referenced by the Dot and requires admin authentication',async()=>{
 const f=await fixture({run:async()=>{throw new Error('No task expected');}});
 try{
  const dot=(await f.request('POST','/dots',{name:'Null'})).json();
  const bytes=Buffer.from([137,80,78,71]),asset=await f.blobs.put(bytes,'avatar.png','image/png');
  const foreign=await f.blobs.put(Buffer.from('private'),'other.txt','text/plain');
  await f.request('PATCH','/dots/'+dot.id,{avatarUrl:'file-service://'+asset.id,avatarManifest:{snapshot:{asset_pointer:'file-service://'+asset.id}}});
  const r=await f.request('GET','/dots/'+dot.id+'/avatar-assets/'+asset.id);
  assert.equal(r.statusCode,200);assert.deepEqual(r.rawPayload,bytes);
  assert.equal((await f.request('GET','/dots/'+dot.id+'/avatar-assets/'+foreign.id)).statusCode,404);
  assert.equal((await f.request('GET','/dots/'+dot.id+'/avatar-assets/'+asset.id,undefined,'wrong')).statusCode,401);
 }finally{await f.cleanup();}
});
