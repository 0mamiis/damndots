import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { startManagedAppServer, managedChildEnvironment } from '../src/managed-appserver.js';

const fixture=`const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2);if(args[0]!=='app-server'||args[1]!=='--listen'||args[2]!=='ws://127.0.0.1:0')process.exit(19);
if(process.env.TEST_EXIT==='yes')process.exit(17);
const config=fs.readFileSync(path.join(process.env.CODEX_HOME,'config.toml'),'utf8');
const snapshot={pid:process.pid,cwd:process.cwd(),home:process.env.CODEX_HOME,config,tokenCorrect:process.env.DOTS_WORKER_TOKEN==='controlled-worker-secret',inheritedCodexKeys:Object.keys(process.env).filter(k=>k.startsWith('CODEX_')),adminTokenAbsent:process.env.DOTS_ADMIN_KEY===undefined,openaiTokenAbsent:process.env.OPENAI_API_KEY===undefined,explicitCert:process.env.CODEX_CA_CERTIFICATE};
fs.writeFileSync(path.join(process.env.CODEX_HOME,'controlled-child.json'),JSON.stringify(snapshot));
let ready=process.env.TEST_READY!=='never';const delay=Number(process.env.TEST_READY_DELAY||0);if(delay){ready=false;setTimeout(()=>ready=true,delay);}
const server=http.createServer((req,res)=>{if(req.url==='/inspect'){res.setHeader('content-type','application/json');res.end(JSON.stringify(snapshot));return;}if(req.headers.origin){res.writeHead(403);res.end();return;}res.writeHead(req.url==='/readyz'&&!ready?503:200);res.end('ok');});
server.listen(0,'127.0.0.1',()=>{const port=server.address().port;process.stdout.write('listening on: ws://127.0.0.1:'+port+'\\n');process.stdout.write('Bearer controlled-');setTimeout(()=>process.stdout.write('worker-secret\\n'),10);});
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`;
async function workspace() {
  const parent=resolve('work');await mkdir(parent,{recursive:true});const path=await mkdtemp(join(parent,'managed-worker-test-'));const script=join(path,'controlled-cli.cjs');await writeFile(script,fixture);return {path,script,close:()=>{const rel=relative(parent,path);assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel));return rm(path,{recursive:true,force:true});}};
}
test('managed child owns atomic loopback port, private config and environment without main settings or persisted token',async()=>{
  const work=await workspace(),log:string[]=[];const previous=process.env.CODEX_HOME;let managed:Awaited<ReturnType<typeof startManagedAppServer>>|undefined;
  try {
    const main=join(work.path,'main-codex-home');await mkdir(main);await writeFile(join(main,'config.toml'),'preserve-main-config');process.env.CODEX_HOME=main;
    managed=await startManagedAppServer({server:'http://127.0.0.1:9340',workerToken:'controlled-worker-secret',dataDir:join(work.path,'worker'),model:'gpt-6.1-sol',childCLIPath:work.script,startupTimeoutMs:2000,env:{CODEX_HOME:main,CODEX_API_BASE_URL:'https://main.example',CODEX_APP_SERVER_CHATGPT_BASE_URL:'https://main.example',DOTS_ADMIN_KEY:'must-not-leak',OPENAI_API_KEY:'must-not-leak',CODEX_CA_CERTIFICATE:join(work.path,'explicit.pem'),TEST_READY_DELAY:'100'},onLog:line=>log.push(line)});
    const response=await fetch(managed.url.replace(/^ws:/,'http:')+'/inspect'),snapshot=await response.json() as any;
    assert.equal(snapshot.tokenCorrect,true);assert(snapshot.home.startsWith(join(work.path,'worker')));assert.equal(snapshot.cwd,snapshot.home);assert.equal(snapshot.adminTokenAbsent,true);assert.equal(snapshot.openaiTokenAbsent,true);assert.deepEqual(snapshot.inheritedCodexKeys.sort(),['CODEX_CA_CERTIFICATE','CODEX_HOME']);assert.equal(snapshot.explicitCert,join(work.path,'explicit.pem'));
    assert(snapshot.config.includes('base_url = "http://127.0.0.1:9340/worker/model"'));assert(snapshot.config.includes('env_key = "DOTS_WORKER_TOKEN"'));assert(snapshot.config.includes('wire_api = "responses"'));assert(snapshot.config.includes('plugins = false'));assert(!snapshot.config.includes('controlled-worker-secret'));assert.equal(await readFile(join(main,'config.toml'),'utf8'),'preserve-main-config');assert(!log.join('\n').includes('controlled-worker-secret'));assert(log.some(line=>line.includes('[redacted]')));
    const health=managed.url.replace(/^ws:/,'http:')+'/healthz';await managed.close();await managed.close();await assert.rejects(fetch(health,{signal:AbortSignal.timeout(200)}));
  }finally{if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;await managed?.close();await work.close();}
});
test('managed startup failures are bounded, clean owned process and never expose worker credential in errors',async()=>{
  const work=await workspace();try{
    await assert.rejects(startManagedAppServer({server:'http://127.0.0.1:1',workerToken:'controlled-worker-secret',dataDir:join(work.path,'exit'),childCLIPath:work.script,env:{TEST_EXIT:'yes'},startupTimeoutMs:1000}),error=>{assert(!String(error).includes('controlled-worker-secret'));return /17/.test(String(error));});
    // Allow the fixture to actually start on slower CI/Windows hosts before testing readiness expiry.
    const started=Date.now();
    await assert.rejects(startManagedAppServer({server:'http://127.0.0.1:1',workerToken:'controlled-worker-secret',dataDir:join(work.path,'timeout'),childCLIPath:work.script,env:{TEST_READY:'never'},startupTimeoutMs:2000}),/startup timeout/);
    assert(Date.now()-started<8000,'startup and owned-child cleanup must remain bounded');
    const snapshot=JSON.parse(await readFile(join(work.path,'timeout','managed-codex-home','controlled-child.json'),'utf8'));
    assert.throws(()=>process.kill(snapshot.pid,0));
  }finally{await work.close();}
});
test('supplied app-server endpoint is not spawned or terminated; insecure remote endpoints are rejected',async()=>{
  const server=createServer((_req,res)=>res.end('user-owned'));await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as any).port;
  try{const supplied=await startManagedAppServer({server:'http://127.0.0.1:1',workerToken:'unused',dataDir:'unused',appServerUrl:`ws://127.0.0.1:${port}`});await supplied.close();assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(),'user-owned');await assert.rejects(startManagedAppServer({server:'http://remote.example',workerToken:'secret',dataDir:'unused'}),/HTTPS/);await assert.rejects(startManagedAppServer({server:'https://remote.example',workerToken:'secret',dataDir:'unused',appServerUrl:'ws://remote.example:9000'}),/WSS/);}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('managed home cannot overlap main home and child environment removes inherited Codex overrides',async()=>{
  const work=await workspace(),previous=process.env.CODEX_HOME;
  try{const main=join(work.path,'main');await mkdir(main);process.env.CODEX_HOME=main;await assert.rejects(startManagedAppServer({server:'http://127.0.0.1:1',workerToken:'secret',dataDir:join(main,'nested'),childCLIPath:work.script}),/main Codex home/);const env=managedChildEnvironment(join(work.path,'worker'),'controlled',{CODEX_API_BASE_URL:'https://main.example',CODEX_HOME:main,ORBIT_DURABLE_WS_URL:'wss://main.example',OPENAI_API_KEY:'main-key',DOTS_MODEL_TOKEN:'server-only'});assert.equal(env.CODEX_API_BASE_URL,undefined);assert.equal(env.ORBIT_DURABLE_WS_URL,undefined);assert.equal(env.OPENAI_API_KEY,undefined);assert.equal(env.DOTS_MODEL_TOKEN,undefined);assert.equal(env.DOTS_WORKER_TOKEN,'controlled');assert.equal(env.CODEX_HOME,join(work.path,'worker'));}finally{if(previous===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previous;await work.close();}
});
