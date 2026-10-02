import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {WebSocketServer,WebSocket} from 'ws';import {NativeGateway} from '../src/gateway.js';
test('an immediate desktop RPC remains a text frame while the upstream handshake is pending',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dots-ws-queue-')),server=createServer((req,res)=>{
  res.setHeader('content-type','application/json');const access='header.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.sig';
  res.end(JSON.stringify({clientId:'local',tokens:{access_token:access,refresh_token:'refresh',id_token:'id'}}));
 }),upstream=new WebSocketServer({noServer:true});let binary:unknown;
 server.on('upgrade',(req,socket,head)=>setTimeout(()=>upstream.handleUpgrade(req,socket,head,ws=>{ws.on('message',(data,isBinary)=>{binary=isBinary;ws.send(data,{binary:isBinary});});}),100));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const gateway=new NativeGateway({server:'http://127.0.0.1:'+(server.address() as any).port,enrollment:'fixture',dataDir:dir,writeCodexProfile:false,port:20000+Math.floor(Math.random()*20000)});
 try{
  await gateway.start();const ca=await readFile(join(dir,'certs/ca.pem'));
  const ws=new WebSocket('wss://localhost:'+gateway.options.port+'/native/app-server',{ca});
  const text=JSON.stringify({id:1,method:'initialize',params:{}});
  const received=await new Promise<string>((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('RPC queue timeout')),5000);ws.on('open',()=>ws.send(text));ws.on('error',reject);ws.on('message',b=>{clearTimeout(timeout);resolve(String(b));});});
  assert.equal(received,text);assert.equal(binary,false);ws.close();
 }finally{await gateway.close();for(const c of upstream.clients)c.close();upstream.close();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
