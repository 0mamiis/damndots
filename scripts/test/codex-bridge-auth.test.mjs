import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('main bridge uses the configured loopback port and rejects missing/wrong tokens before launching Codex',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dots-bridge-auth-'));
 const portServer=net.createServer();portServer.listen(0,'127.0.0.1');await once(portServer,'listening');
 const port=portServer.address().port;await new Promise(r=>portServer.close(r));
 const tokenFile=join(dir,'token.txt'),configFile=join(dir,'config.json');
 await writeFile(tokenFile,'controlled-fixture-token-for-local-test');
 await writeFile(configFile,JSON.stringify({port,directory:dir,tokenFile,cli:join(dir,'not-a-codex-executable'),codexHome:dir}));
 const child=spawn(process.execPath,['scripts/codex-main-bridge.cjs','--config',configFile],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','ignore','pipe']});
 let stderr='';child.stderr.on('data',b=>stderr+=b);
 const request=authorization=>new Promise((resolve,reject)=>{
  const s=net.connect(port,'127.0.0.1');let text='';
  s.on('error',reject);s.on('data',d=>text+=d);s.on('close',()=>resolve(text));
  s.on('connect',()=>s.write('GET / HTTP/1.1\r\nHost: localhost\r\n'+(authorization?'Authorization: Bearer '+authorization+'\r\n':'')+'\r\n'));
 });
 try{
  let ready=false;for(let i=0;i<100&&!ready;i++){try{assert.match(await request(),/^HTTP\/1.1 401/);ready=true;}catch{await new Promise(r=>setTimeout(r,20));}}
  assert.equal(ready,true,stderr);
  assert.match(await request('invalid-fixture-token'),/^HTTP\/1.1 401/);
  assert.equal(child.exitCode,null);
 }finally{child.kill();await once(child,'exit');await rm(dir,{recursive:true,force:true});}
});
