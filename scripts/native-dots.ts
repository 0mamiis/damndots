// Original MSIX activation uses process-scoped API settings and the existing Codex home.
// No primary OAuth/config file, shortcut or installed application file is rewritten.
import {NativeGateway} from '../apps/client/src/gateway.js';
import {UPSTREAM_ORIGIN} from '../apps/client/src/native-upstream.js';
import {acquireLaunchLock} from '../apps/client/src/launch-policy.js';
import {mkdir,writeFile,copyFile,rm,readdir,stat,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const root=resolve(import.meta.dirname,'..'),stack=resolve(process.env.DOTS_STACK_DIR||join(root,'.data/local-stack'));
const data=join(stack,'native'),main=process.env.DOTS_MAIN_CODEX_HOME||join(homedir(),'.codex');
if(existsSync(join(data,'disabled')))process.exit(0);
const release=await acquireLaunchLock(join(data,'runtime.lock'));
if(!release){console.log('Orijinal Codex baglantisi zaten hazir.');process.exit(0);}
process.once('exit',()=>{void release();});
const check=process.argv.includes('--check-only');
await mkdir(data,{recursive:true});
let target:any;try{target=JSON.parse(await readFile(join(data,'connection-target.json'),'utf8'));}catch{}
if(target?.client)await writeFile(join(data,'client.json'),JSON.stringify(target.client),{mode:0o600});
else if(!existsSync(join(data,'client.json')))await copyFile(join(stack,'client-main/client.json'),join(data,'client.json'));
const port=Number(process.env.DOTS_NATIVE_PORT||8000);
const gateway=new NativeGateway({server:target?.serverUrl||process.env.DOTS_SERVER_URL||'http://127.0.0.1:9340',dataDir:data,port,writeCodexProfile:false,identityHome:main,upstream:UPSTREAM_ORIGIN,logFile:join(data,'gateway.log'),trace:existsSync(join(data,'trace'))});
await gateway.start();
let switching=false,targetRevision=target?.revision;
const targetWatch=setInterval(()=>{if(switching)return;switching=true;void readFile(join(data,'connection-target.json'),'utf8').then(JSON.parse).then(async next=>{if(next.revision===targetRevision)return;await gateway.changeConnection(next.serverUrl,next.client);targetRevision=next.revision;console.log('Native Dot host updated: '+next.serverUrl);}).catch(()=>{}).finally(()=>{switching=false;});},1000);
const certificate=join(data,'certs/ca.pem'),run=promisify(execFile);
const cliDirectory=join(process.env.LOCALAPPDATA||join(homedir(),'AppData/Local'),'OpenAI/Codex/bin');
const candidates=[];for(const name of await readdir(cliDirectory)){const file=join(cliDirectory,name,'codex.exe'),host=join(cliDirectory,name,'codex-code-mode-host.exe');try{if(existsSync(file)){candidates.push({file,hasHost:existsSync(host),time:(await stat(file)).mtimeMs});}}catch{}}
candidates.sort((a,b)=>(b.hasHost===a.hasHost?b.time-a.time:(b.hasHost?1:-1)));if(!candidates[0])throw new Error('Kurulu Codex CLI bulunamadi.');
await writeFile(join(data,'cli-bridge.json'),JSON.stringify({realCli:candidates[0].file,node:process.execPath,script:join(root,'scripts/native-cli-bridge.mjs'),gateway:'https://localhost:'+port,certificate},null,2),{mode:0o600});
if(!check)await run('certutil.exe',['-user','-addstore','Root',certificate],{windowsHide:true,maxBuffer:4000});
// Same environment as a normal launch except desktop API traffic. The app keeps its own CODEX_HOME, SQLite state,
// real login and OpenCodex model routing; the gateway sends everything except Dot-owned routes to the real service.
// CODEX_CLI_PATH selects the local bridge; cloud threads still need the native WebSocket transport.
const environment={
 CODEX_API_BASE_URL:'https://localhost:'+port+'/backend-api',
 CODEX_CLI_PATH:join(data,'native-cli.exe'),
 NODE_EXTRA_CA_CERTS:certificate
};
await writeFile(join(data,'environment.json'),JSON.stringify({environment},null,2),{mode:0o600});
const helper=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(root,'scripts/main-codex/native-package.ps1'),'-EnvironmentFile',join(data,'environment.json'),'-ParentPid',String(process.pid),...check?['-CheckOnly']:[]],{windowsHide:true,stdio:'inherit',env:{...process.env,PSModulePath:undefined}});
let closing=false;
async function close(){
 if(closing)return;closing=true;
 clearInterval(targetWatch);
 if(helper.exitCode===null){
  await writeFile(join(data,'package-stop'),'stop');
  await new Promise<void>(resolve=>{const timeout=setTimeout(resolve,6000);helper.once('exit',()=>{clearTimeout(timeout);resolve();});});
  if(helper.exitCode===null){helper.kill();await run('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(root,'scripts/main-codex/native-disable.ps1')],{windowsHide:true,env:{...process.env,PSModulePath:undefined}}).catch(()=>{});}
 }
 await gateway.close();await rm(join(data,'package-ready.json'),{force:true});await release();
}
helper.once('error',error=>{console.error(error.message);void close().then(()=>{process.exitCode=1;});});
helper.once('exit',code=>{if(!closing)void close().then(()=>{process.exitCode=code||0;});});
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void close();});
const parent=Number(process.env.DOTS_NATIVE_PARENT_PID);
if(!check&&parent>0){const watch=setInterval(()=>{try{process.kill(parent,0);}catch{clearInterval(watch);void close();}},2000);watch.unref();}
