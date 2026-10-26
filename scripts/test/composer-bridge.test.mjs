import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('local-only bridge protects prediction settings and retains Dot sender validation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dots-composer-bridge-'));
 const testToken='T'.repeat(40);
 const reserve=net.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
 for(const name of ['codex-local-tools-bridge.cjs','composer-prediction-settings.cjs','composer-prediction-models.cjs'])fs.copyFileSync(fileURLToPath(new URL('../'+name,import.meta.url)),path.join(dir,name));
 fs.writeFileSync(path.join(dir,'token.txt'),testToken);fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({localOnly:true,localPort:port,nativeGateway:'https://localhost:8000',certificate:path.join(dir,'unused.pem'),composerAppRoot:dir}));
 const child=spawn(process.execPath,[path.join(dir,'codex-local-tools-bridge.cjs')],{env:{...process.env,DOTS_LOCAL_BRIDGE_DIR:dir},stdio:'ignore',windowsHide:true});
 try{
  const endpoint='http://127.0.0.1:'+port;let ready=false;
  for(let n=0;n<40&&!ready;n++){try{ready=(await fetch(endpoint+'/composer-predictions')).status===401;}catch{}if(!ready)await new Promise(resolve=>setTimeout(resolve,50));}
  assert.equal(ready,true,'bridge starts without SSH');
  const headers={authorization:'Bearer '+testToken,'content-type':'application/json'};
  assert.equal((await fetch(endpoint+'/composer-predictions')).status,401);
  assert.equal((await (await fetch(endpoint+'/composer-predictions',{headers})).json()).enabled,false);
  const save=await fetch(endpoint+'/composer-predictions',{method:'PATCH',headers,body:JSON.stringify({enabled:true,model:'gpt-6-luna',effort:'high',fast:true})});assert.equal(save.status,200);assert.equal((await save.json()).enabled,true);
  assert.equal((await fetch(endpoint+'/composer-predictions',{method:'PATCH',headers,body:JSON.stringify({enabled:true,prompt:'unexpected'})})).status,400);
  assert.equal((await fetch(endpoint+'/call',{method:'POST',headers,body:JSON.stringify({tool:'list_threads',arguments:{}})})).status,502);
 }finally{
  child.kill();await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(resolve,2000).unref();});
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
