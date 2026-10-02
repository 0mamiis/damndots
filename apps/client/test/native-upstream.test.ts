import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import https from 'node:https';
import {NativeGateway} from '../src/gateway.js';
import {isDotsRoute,isLocalFirstRoute,mergeStatsig,enableDotsAccount} from '../src/native-upstream.js';
const token=(body:unknown)=>'h.'+Buffer.from(JSON.stringify(body)).toString('base64url')+'.s';
test('Dot routes are the only local routes; account, plugin and settings routes stay real',()=>{
 for(const path of ['/backend-api/tbo','/backend-api/tbo/one/computer/sessions','/backend-api/messaging/rooms/one/messages','/backend-api/cloud-aeons/primary','/backend-api/celsius/ws/user'])assert.equal(isDotsRoute(path),true,path);
 for(const path of ['/backend-api/settings/user','/backend-api/ps/plugins/list','/backend-api/connectors/directory/list','/backend-api/accounts/check/v4','/backend-api/automations','/backend-api/wham/tasks/list','/backend-api/tbofake'])assert.equal(isDotsRoute(path),false,path);
 assert.equal(isLocalFirstRoute('/backend-api/files/download/file_1'),true);
});
test('real feature flags are preserved while Dots flags and availability are added; incompatible hashes never fabricate flags',()=>{
 const real={statsigPayload:JSON.stringify({hash_used:'djb2',feature_gates:{real:{value:true},shared:{value:false}},user:{userID:'actual'}})},local={statsigPayload:JSON.stringify({hash_used:'djb2',feature_gates:{dots:{value:true},shared:{value:true}},user:{userID:'local'}})};
 const merged=JSON.parse((mergeStatsig(real,local) as any).statsigPayload);assert.equal(merged.feature_gates.real.value,true);assert.equal(merged.feature_gates.dots.value,true);assert.equal(merged.feature_gates.shared.value,true);assert.equal(merged.user.userID,'actual');
 assert.equal(mergeStatsig({statsigPayload:JSON.stringify({hash_used:'sha256',feature_gates:{}})},local),undefined);
 const accounts=enableDotsAccount({accounts:{real:{account:{plan_type:'plus',tbo_config:{other:true,plan_eligible:false}},features:['x']}},default:'real'}) as any;assert.equal(accounts.accounts.real.account.plan_type,'plus');assert.equal(accounts.accounts.real.account.tbo_config.tbo_available,true);assert.equal(accounts.accounts.real.account.tbo_config.plan_eligible,true);assert.equal(accounts.accounts.real.account.tbo_config.other,true);
});
test('gateway sends Dot traffic to Dots with its local token and everything else to the real service with the desktop login',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dots-split-')),seen:{service:string;path:string;authorization?:string}[]=[];
 const dots=createServer((req,res)=>{seen.push({service:'dots',path:req.url||'',authorization:req.headers.authorization});res.setHeader('content-type','application/json');
  if(req.url==='/client/enroll')return res.end(JSON.stringify({clientId:'local',tokens:{access_token:token({exp:Math.floor(Date.now()/1000)+3600}),refresh_token:'refresh',id_token:'id'}}));
  if(req.url==='/backend-api/wham/statsig/bootstrap')return res.end(JSON.stringify({statsigPayload:JSON.stringify({hash_used:'djb2',feature_gates:{dots:{value:true}}})}));
  if(req.url?.startsWith('/backend-api/files/download/'))return res.writeHead(404).end(JSON.stringify({}));
  res.end(JSON.stringify({service:'dots',url:req.url}));});
 const real=createServer((req,res)=>{seen.push({service:'real',path:req.url||'',authorization:req.headers.authorization});res.setHeader('content-type','application/json');
  if(req.url==='/backend-api/wham/statsig/bootstrap')return res.end(JSON.stringify({statsigPayload:JSON.stringify({hash_used:'djb2',feature_gates:{real:{value:true}}})}));
  if(req.url==='/backend-api/accounts/check/v4')return res.end(JSON.stringify({accounts:{actual:{account:{plan_type:'plus'}}}}));
  res.end(JSON.stringify({service:'real',url:req.url}));});
 await new Promise<void>(r=>dots.listen(0,'127.0.0.1',r));await new Promise<void>(r=>real.listen(0,'127.0.0.1',r));
 const port=22000+Math.floor(Math.random()*15000),gateway=new NativeGateway({server:'http://127.0.0.1:'+(dots.address() as any).port,upstream:'http://127.0.0.1:'+(real.address() as any).port,enrollment:'x',dataDir:dir,writeCodexProfile:false,port});
 try{
  await gateway.start();const ca=await readFile(join(dir,'certs/ca.pem'));
  const call=(path:string,method='GET')=>new Promise<any>((resolve,reject)=>{const r=https.request('https://localhost:'+port+path,{method,ca,headers:{authorization:'Bearer desktop-login'}},res=>{let s='';res.on('data',b=>s+=b);res.on('end',()=>resolve(JSON.parse(s)));});r.on('error',reject);r.end(method==='POST'?'{}':undefined);});
  assert.equal((await call('/backend-api/tbo')).service,'dots');
  assert.equal((await call('/backend-api/ps/plugins/list')).service,'real');
  assert.equal((await call('/backend-api/settings/voices')).service,'real');
  const speechContext=JSON.parse(await readFile(join(dir,'codex-speech-headers.json'),'utf8'));
  assert.equal(speechContext.authorization,undefined);assert.equal(speechContext.cookie,undefined);
  assert.ok(!JSON.stringify(speechContext).includes('desktop-login'));
  assert.equal((await call('/backend-api/files/download/file_real')).service,'real');
  assert.equal((await call('/backend-api/accounts/check/v4')).accounts.actual.account.tbo_config.tbo_available,true);
  const flags=JSON.parse((await call('/backend-api/wham/statsig/bootstrap','POST')).statsigPayload).feature_gates;assert.equal(flags.real.value,true);assert.equal(flags.dots.value,true);
  const dotsCalls=seen.filter(x=>x.service==='dots'&&x.path.startsWith('/backend-api/tbo')),realCalls=seen.filter(x=>x.service==='real'&&x.path.startsWith('/backend-api/ps/plugins'));
  assert.ok(dotsCalls[0].authorization&&dotsCalls[0].authorization!=='Bearer desktop-login');assert.equal(realCalls[0].authorization,'Bearer desktop-login');
 }finally{await gateway.close();await new Promise<void>(r=>dots.close(()=>r()));await new Promise<void>(r=>real.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
