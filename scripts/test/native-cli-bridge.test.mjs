import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Large thread payloads used to be decoded as one string and crashed the bridge (RangeError: Invalid string length).
test('bridge forwards oversized CLI lines as bytes and still rewrites workspace routing',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dots-bridge-'));
 try{
  const big=12*1024*1024;
  fs.writeFileSync(path.join(dir,'cli.cjs'),`const w=s=>new Promise(r=>process.stdout.write(s)?r():process.stdout.once('drain',r));(async()=>{
await w(JSON.stringify({id:1,result:{workspaceRouting:{backendOrigin:'https://chatgpt.com'}}})+'\\n');
await w('{"id":2,"result":"');const b=Buffer.alloc(1024*1024,98);for(let n=0;n<${big};n+=b.length)await w(b);await w('"}\\n');
await w('{"id":3}\\n');})();`);
  fs.writeFileSync(path.join(dir,'ca.pem'),'x');
  fs.writeFileSync(path.join(dir,'m.json'),JSON.stringify({realCli:process.execPath,gateway:'https://127.0.0.1:9',certificate:path.join(dir,'ca.pem')}));
  const child=spawn(process.execPath,[path.resolve('scripts/native-cli-bridge.mjs'),path.join(dir,'m.json'),path.join(dir,'cli.cjs')],{env:{...process.env,LOCALAPPDATA:dir},stdio:['pipe','pipe','pipe']});
  const chunks=[];child.stdout.on('data',c=>chunks.push(c));
  const code=await new Promise(r=>child.on('exit',r));
  const lines=Buffer.concat(chunks).toString('utf8').split('\n');
  assert.equal(code,0);
  assert.equal(JSON.parse(lines[0]).result.workspaceRouting.backendOrigin,'https://127.0.0.1:9');
  assert.equal(JSON.parse(lines[1]).result.length,big);
  assert.deepEqual(JSON.parse(lines[2]),{id:3});
  assert.equal(lines[3],'');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
