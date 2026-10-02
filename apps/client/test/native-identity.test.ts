import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createServer} from 'node:http';import https from 'node:https';
import {NativeGateway} from '../src/gateway.js';
const jwt=(body:unknown)=>'header.'+Buffer.from(JSON.stringify(body)).toString('base64url')+'.signature';
test('original desktop identity is consistent while enrollment and refresh leave primary auth/config untouched',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dots-native-identity-')),home=join(dir,'main'),data=join(dir,'gateway');await mkdir(home);
 const auth=JSON.stringify({tokens:{access_token:jwt({'https://api.openai.com/auth':{chatgpt_account_id:'actual-account',user_id:'actual-user',chatgpt_account_user_id:'actual-membership',chatgpt_plan_type:'plus'}}),account_id:'actual-account'}}),config='openai_base_url = "http://127.0.0.1:10100/v1"\n';
 await writeFile(join(home,'auth.json'),auth);await writeFile(join(home,'config.toml'),config);
 const server=createServer((req,res)=>{res.setHeader('content-type','application/json');
  if(req.url==='/client/enroll')return res.end(JSON.stringify({clientId:'local-client',tokens:{access_token:jwt({exp:Math.floor(Date.now()/1000)+3600}),refresh_token:'local-refresh',id_token:'local-id'}}));
  if(req.url==='/auth/oauth/token')return res.end(JSON.stringify({access_token:jwt({exp:Math.floor(Date.now()/1000)+3600}),refresh_token:'new-local-refresh',id_token:'new-id'}));
  if(req.url==='/backend-api/wham/accounts/check')return res.end(JSON.stringify({accounts:[{id:'acct_local_orbit',account_user_id:'user_local_orbit',plan_type:'pro'}],default_account_id:'acct_local_orbit'}));
  if(req.url==='/backend-api/wham/statsig/bootstrap')return res.end(JSON.stringify({statsigPayload:JSON.stringify({user:{userID:'user_local_orbit',customIDs:{account_id:'acct_local_orbit'},custom:{plan_type:'pro'}},feature_gates:{gate:{value:true}}})}));
  return res.end(JSON.stringify({text:'User message retains acct_local_orbit and user_local_orbit.'}));
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+(server.address() as any).port;
 const gateway=new NativeGateway({server:base,dataDir:data,writeCodexProfile:false,identityHome:home,enrollment:'private-token',port:0});
 try{
  await gateway.enroll();await gateway.refresh();
  assert.equal(await readFile(join(home,'auth.json'),'utf8'),auth);assert.equal(await readFile(join(home,'config.toml'),'utf8'),config);
  // A random free port keeps this test separate from user services.
  (gateway.options as any).port=18000+Math.floor(Math.random()*10000);
  await gateway.start();const ca=await readFile(join(data,'certs/ca.pem'));
  const get=(path:string)=>new Promise<any>((resolve,reject)=>{https.get('https://localhost:'+gateway.options.port+path,{ca},r=>{let text='';r.on('data',b=>text+=b);r.on('end',()=>resolve(JSON.parse(text)));}).on('error',reject);});
  const accounts=await get('/backend-api/wham/accounts/check');assert.equal(accounts.accounts[0].id,'actual-account');assert.equal(accounts.accounts[0].account_user_id,'actual-membership');assert.equal(accounts.accounts[0].plan_type,'plus');assert.equal(accounts.default_account_id,'actual-account');
  const bootstrap=JSON.parse((await get('/backend-api/wham/statsig/bootstrap')).statsigPayload);assert.equal(bootstrap.user.userID,'actual-user');assert.equal(bootstrap.user.custom.plan_type,'plus');assert.equal(bootstrap.feature_gates.gate.value,true);
  assert.equal((await get('/backend-api/tbo/one/messages')).text,'User message retains acct_local_orbit and user_local_orbit.');
 }finally{await gateway.close();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
