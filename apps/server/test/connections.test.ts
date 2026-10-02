import test from 'node:test';import assert from 'node:assert/strict';
import {HostConnections,hostOrigin} from '../src/connections.js';
import {SecretVault} from '../src/integrations/security.js';import {SqliteStore} from '../src/storage.js';
function fixture(online=true,remoteDots:any[]|null=null){const store=new SqliteStore(':memory:'),calls:any[]=[];let registrations=0,blocked=false;
 const fetcher:typeof fetch=async(url,init)=>{assert.equal(init?.redirect,'error');const u=new URL(String(url)),body=init?.body instanceof FormData?null:init?.body?JSON.parse(String(init.body)):null;calls.push({origin:u.origin,path:u.pathname,body,method:init?.method});let value:any;
  if(u.pathname.endsWith('/avatar-assets/file_abcd'))return new Response(new Uint8Array([137,80,78,71]),{headers:{'content-type':'image/png'}});
  if(u.pathname.endsWith('/attachments')){assert(init?.body instanceof FormData);const file=init.body.get('file') as File;assert.equal(file.type,'image/png');assert.equal(file.size,4);return new Response(JSON.stringify({id:'file_fedc'}),{headers:{'content-type':'application/json'}});}
  if(u.pathname==='/health')value={ok:true,connectionProtocol:1,version:'0.1.0'};
  else if(u.pathname==='/api/v1/session')value={accessToken:'controlled-session',expiresAt:new Date(Date.now()+86400000).toISOString()};
  else if(u.pathname==='/api/v1/overview')value={tasks:blocked?[{status:'running'}]:[]};
  else if(u.pathname.endsWith('/enrollment'))value={token:'controlled-enrollment'};
  else if(u.pathname==='/client/enroll')value={clientId:'client-'+(++registrations),tokens:{access_token:'controlled-access',refresh_token:'controlled-refresh'}};
  else if(u.pathname==='/worker/register')value={computerId:'pc-'+(++registrations),token:'controlled-worker'};
  else if(u.pathname==='/api/v1/computers'&&init?.method!=='PATCH')value={items:[{id:'vps-1',name:'VPS',platform:'win32',state:online?'online':'offline',capabilities:['codex','browser'],roots:[],token:'must-not-leak'},{id:'vps-2',name:'Spare',platform:'win32',state:'offline',capabilities:['codex'],roots:[]}]};
  else if(u.pathname==='/api/v1/dots/dot-1')value={id:'dot-1',name:'Null',model:'m',reasoningEffort:'high',serviceTier:null,instructions:'be kind',avatarUrl:'file-service://file_abcd',avatarManifest:{pet_id:'null-signal',snapshot:{asset_pointer:'file-service://file_abcd'}},rootThreadId:'source-root',messagingRoomId:'source-room',computerId:'old-pc'};
  else if(u.pathname==='/api/v1/dots'&&init?.method==='POST')value={id:'remote-dot',name:body.name};
  else if(u.pathname==='/api/v1/dots'&&u.origin==='http://127.0.0.1:9340')value={items:[{id:'dot-1',name:'Null'},{id:'dot-2',name:'Other'}]};
  else if(u.pathname==='/api/v1/dots'&&(init?.method||'GET')==='GET')value={items:remoteDots??[{id:'dot-1',computerId:'old-pc'},{id:'dot-2',computerId:null}]};
  else value={ok:true};return new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
 };
 const service=new HostConnections(store,new SecretVault(Buffer.alloc(32,9)),{url:'http://127.0.0.1:9340',adminKey:'controlled-local-key'},fetcher);
 service.bootstrap({options:{nativeEnabled:true,workerEnabled:true,linuxEnabled:false,gatewayPort:8000,workerRoots:['C:/Workspace']}});
 return {store,service,calls,block:()=>{blocked=true;}};
}
test('host profiles keep credentials encrypted and expose only public connection information',async()=>{
 const f=fixture();try{const p=f.service.create({name:'VPS',serverUrl:'https://dots.example.com',adminKey:'controlled-remote-secret'});assert.equal(p.hasKey,true);assert(!JSON.stringify(p).includes('controlled-remote-secret'));assert(!JSON.stringify(f.store.list('host_profiles')).includes('controlled-remote-secret'));assert.equal((await f.service.test(p.id)).ok,true);assert(f.service.list().find(h=>h.id===p.id)?.verifiedAt);for(const address of ['http://192.0.2.1','https://user:password@example.com','https://example.com/hidden','https://example.com/?token=test','ftp://localhost'])assert.throws(()=>hostOrigin(address));}finally{f.store.close();}
});
test('activation registers credentials once, snapshots applied options and keeps native/worker tokens off status responses',async()=>{
 const f=fixture();try{const p=f.service.create({name:'VPS',serverUrl:'https://dots.example.com',adminKey:'controlled-key'});f.service.update(p.id,{options:{workerRoots:['C:/Work'],linuxEnabled:true}});await f.service.activate(p.id);const plan=f.service.plan();assert.equal(plan.serverUrl,p.serverUrl);assert(plan.client&&plan.windows&&plan.linux);assert.equal(f.calls.filter(c=>c.path==='/worker/register').length,2);assert(!JSON.stringify(f.service.status()).includes('controlled-worker'));assert(!JSON.stringify(f.store.get('host_active','owner')).includes('controlled-worker'));f.service.update(p.id,{options:{gatewayPort:8010}});assert.equal(f.service.plan().options.gatewayPort,8000);await f.service.activate(p.id);assert.equal(f.service.plan().options.gatewayPort,8010);assert.equal(f.calls.filter(c=>c.path==='/worker/register').length,2);assert.throws(()=>f.service.remove(p.id));await f.service.activate('local');assert.equal(f.service.plan().id,'local');assert.equal(f.service.remove(p.id).deleted,true);}finally{f.store.close();}
});
test('a host switch refuses to interrupt active work',async()=>{
 const f=fixture();try{const p=f.service.create({name:'VPS',serverUrl:'https://dots.example.com',adminKey:'controlled-key'});f.service.update(p.id,{options:{workerRoots:['C:/Work']}});f.block();await assert.rejects(f.service.activate(p.id),/çalışan görevleri/);assert.equal(f.service.status().activeId,'local');assert.equal(f.calls.filter(c=>c.path==='/client/enroll').length,0);}finally{f.store.close();}
});
test('computer mode changes select PC by default and Linux explicitly, with a default computer on the active backend',async()=>{
 const f=fixture();try{assert.equal(f.service.plan().options.computerMode,'pc');f.service.update('local',{options:{computerMode:'linux'}});const linux=f.service.list()[0].options;assert.equal(linux.linuxEnabled,true);assert.equal(linux.workerEnabled,false);await f.service.activate('local');const selected=f.service.plan().linux.computerId;assert(f.calls.some(c=>c.path==='/api/v1/settings'&&c.body.defaultComputerId===selected));f.service.update('local',{options:{computerMode:'pc'}});await f.service.activate('local');assert.equal(f.service.plan().options.computerMode,'pc');assert.equal(f.service.plan().options.workerEnabled,true);}finally{f.store.close();}
});

test('host computer mode uses a computer that is already registered on the backend and never enrolls a local worker',async()=>{
 const f=fixture();try{const p=f.service.create({name:'VPS',serverUrl:'https://dots.example.com',adminKey:'controlled-key'});
  const listed=await f.service.computers(p.id);assert.deepEqual(listed.items.map((c:any)=>c.id),['vps-1','vps-2']);assert(!JSON.stringify(listed).includes('token'));
  f.service.update(p.id,{options:{computerMode:'host'}});const options=f.service.list().find(h=>h.id===p.id)!.options;assert.equal(options.computerMode,'host');assert.equal(options.workerEnabled,false);assert.equal(options.linuxEnabled,false);
  await f.service.activate(p.id);const plan=f.service.plan();assert.equal(plan.options.workerEnabled,false);assert.equal(plan.windows,undefined);
  assert.equal(f.calls.filter(c=>c.path==='/worker/register').length,0);
  assert(f.calls.some(c=>c.path==='/api/v1/settings'&&c.body.defaultComputerId==='vps-1'));
  const moved=f.calls.filter(c=>c.method==='PATCH'&&c.path.startsWith('/api/v1/dots/')).map(c=>c.path+':'+c.body.computerId);assert.deepEqual(moved,['/api/v1/dots/dot-1:vps-1','/api/v1/dots/dot-2:vps-1']);
 }finally{f.store.close();}
});
test('host computer mode honors an explicit choice and refuses a missing or unavailable computer',async()=>{
 const f=fixture();try{const p=f.service.create({name:'VPS',serverUrl:'https://dots.example.com',adminKey:'controlled-key'});
  f.service.update(p.id,{options:{computerMode:'host',hostComputerId:'vps-2'}});await f.service.activate(p.id);assert(f.calls.some(c=>c.path==='/api/v1/settings'&&c.body.defaultComputerId==='vps-2'));
  f.service.update(p.id,{options:{hostComputerId:'gone'}});await assert.rejects(f.service.activate(p.id),/bulunamadı/);
  assert.equal(f.service.status().activeId,p.id);
 }finally{f.store.close();}
});
test('host computer mode without any online computer is rejected before the active backend changes',async()=>{
 const f=fixture(false);try{const p=f.service.create({name:'VPS',serverUrl:'https://dots.example.com',adminKey:'controlled-key'});
  f.service.update(p.id,{options:{computerMode:'host'}});await assert.rejects(f.service.activate(p.id),/çevrimiçi bir bilgisayar yok/);assert.equal(f.service.status().activeId,'local');
 }finally{f.store.close();}
});



test('a host can issue a computer enrollment and receive a copy of a local Dot definition with its avatar and cached native IDs',async()=>{
 const f=fixture();try{const p=f.service.create({name:'VPS',serverUrl:'https://dots.example.com',adminKey:'controlled-key'});
  const e=await f.service.enrollment(p.id);assert.equal(e.token,'controlled-enrollment');assert.equal(e.serverUrl,'https://dots.example.com');
  assert.deepEqual((await f.service.localDots()).items,[{id:'dot-1',name:'Null'},{id:'dot-2',name:'Other'}]);
  const copy=await f.service.copyDot(p.id,'dot-1');assert.deepEqual(copy,{id:'remote-dot',name:'Null',existing:false});
  const created=f.calls.find(c=>c.origin==='https://dots.example.com'&&c.path==='/api/v1/dots'&&c.method==='POST');assert.deepEqual(created!.body,{name:'Null',model:'m',reasoningEffort:'high',serviceTier:null,instructions:'be kind'});
  assert(!JSON.stringify(created).includes('avatar'),'definition is created before uploading target assets');
  const icon=f.calls.find(c=>c.path==='/api/v1/dots/remote-dot'&&c.method==='PATCH');
  assert.deepEqual(icon!.body,{avatarUrl:'file-service://file_fedc',avatarManifest:{pet_id:'null-signal',snapshot:{asset_pointer:'file-service://file_fedc'}}});
  assert.equal(f.calls.filter(c=>c.path.endsWith('/attachments')).length,1);
  const alias=f.calls.find(c=>c.path==='/api/v1/dots/remote-dot/native-aliases');
  assert.deepEqual(alias!.body,{dotId:'dot-1',threadId:'source-root',roomId:'source-room'});
  await assert.rejects(f.service.copyDot('local','dot-1'),/zaten yerel/);
 }finally{f.store.close();}
});
test('copying a Dot never overwrites a Dot with the same name on the target backend',async()=>{
 const f=fixture(true,[{id:'remote-existing',name:'Null',computerId:null,avatarUrl:'file-service://file_existing'}]);try{const p=f.service.create({name:'VPS',serverUrl:'https://dots.example.com',adminKey:'controlled-key'});
  const copy=await f.service.copyDot(p.id,'dot-1');assert.deepEqual(copy,{id:'remote-existing',name:'Null',existing:true});
  assert(!f.calls.some(c=>c.origin==='https://dots.example.com'&&c.path==='/api/v1/dots'&&c.method==='POST'));
 }finally{f.store.close();}
});


