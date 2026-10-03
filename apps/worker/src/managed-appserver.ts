import { spawn, type ChildProcess } from 'node:child_process';
import { access, chmod, mkdir, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { delimiter, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {allowsPlainHttp} from '@dots/contracts/network';

export interface ManagedAppServerOptions {
  server:string;
  workerToken:string;
  dataDir:string;
  model?:string;
  appServerUrl?:string;
  childCLIPath?:string;
  nodePath?:string;
  env?:NodeJS.ProcessEnv;
  startupTimeoutMs?:number;
  onLog?:(line:string)=>void;
}
export interface ManagedAppServer {url:string;close:()=>Promise<void>;}

function required(value:string|undefined,name:string):string {
  if(!value?.trim())throw new Error(`${name} is required`);return value;
}
function loopback(host:string):boolean{return ['127.0.0.1','localhost','[::1]'].includes(host);}
function serverBase(value:string):string {
  const url=new URL(required(value,'worker server'));
  if(url.username||url.password||url.search||url.hash||!['http:','https:'].includes(url.protocol)||url.protocol==='http:'&&!allowsPlainHttp(url.hostname))throw new Error('Worker server requires HTTPS, loopback HTTP or a Tailscale address, without URL credentials');
  return url.href.replace(/\/$/,'');
}
function suppliedUrl(value:string):string {
  const url=new URL(value);
  if(url.username||url.password||url.hash||!['ws:','wss:'].includes(url.protocol)||url.protocol==='ws:'&&!loopback(url.hostname))throw new Error('App-server endpoint requires WSS or loopback WS without URL credentials');
  return url.href;
}
function within(root:string,target:string):boolean {const rel=relative(root,target);return !rel||(!rel.startsWith('..')&&!isAbsolute(rel));}
async function privateHome(dataDir:string):Promise<string> {
  const root=resolve(required(dataDir,'worker dataDir'));
  const requestedForbidden=[join(homedir(),'.codex'),process.env.CODEX_HOME].filter((p):p is string=>Boolean(p)).map(p=>resolve(p));
  const forbidden=[...requestedForbidden,...await Promise.all(requestedForbidden.map(async p=>{try{return await realpath(p);}catch{return p;}}))];
  if(forbidden.some(p=>within(p,root)))throw new Error('Worker data directory cannot be inside the main Codex home');
  await mkdir(root,{recursive:true,mode:0o700});const realRoot=await realpath(root);
  if(forbidden.some(p=>within(p,realRoot)))throw new Error('Worker data directory resolves inside the main Codex home');
  const home=join(realRoot,'managed-codex-home');await mkdir(home,{recursive:true,mode:0o700});
  const realHome=await realpath(home);
  if(!within(realRoot,realHome)||forbidden.some(p=>within(p,realHome)))throw new Error('Managed Codex home must stay inside worker data directory');
  return realHome;
}
export function managedChildEnvironment(home:string,token:string,overrides:NodeJS.ProcessEnv={}):NodeJS.ProcessEnv {
  const env:NodeJS.ProcessEnv={...process.env,...overrides};
  for(const key of Object.keys(env))if(/^(?:CODEX_|ORBIT_|OPENAI_|DOTS_)/i.test(key)||/^NODE_OPTIONS$/i.test(key))delete env[key];
  // Only an explicitly supplied certificate override may survive CODEX_* stripping.
  for(const key of ['CODEX_CA_CERTIFICATE','SSL_CERT_FILE','NODE_EXTRA_CA_CERTS'])if(overrides[key]!==undefined)env[key]=overrides[key];
  env.CODEX_HOME=home;env.DOTS_WORKER_TOKEN=token;
  return env;
}
async function exists(path:string):Promise<boolean>{try{await access(path,constants.F_OK);return true;}catch{return false;}}
async function executable(path:string):Promise<{command:string;prefix:string[]}> {
  const absolute=resolve(path),extension=extname(absolute).toLowerCase();
  if(!await exists(absolute))throw new Error('Configured Codex CLI executable was not found');
  if(['.js','.cjs','.mjs'].includes(extension))return {command:process.execPath,prefix:[absolute]};
  if(['.cmd','.bat','.ps1'].includes(extension)) {
    // npm's Windows wrapper is not a directly spawnable executable. Use its
    // package entrypoint without a shell, never evaluate wrapper text.
    const entries=[join(dirname(absolute),'node_modules','@openai','codex','bin','codex.js'),join(dirname(absolute),'..','@openai','codex','bin','codex.js')];
    for(const entry of entries)if(await exists(entry))return {command:process.execPath,prefix:[entry]};
    throw new Error('Codex CLI shell wrapper is unsupported; point DOTS_CODEX_CLI to codex.exe or bin/codex.js');
  }
  return {command:absolute,prefix:[]};
}
async function resolveCli(configured:string|undefined,env:NodeJS.ProcessEnv):Promise<{command:string;prefix:string[]}> {
  const value=configured??process.env.DOTS_CODEX_CLI;
  const directories=(env.PATH??env.Path??'').split(delimiter).filter(Boolean);
  if(value) {
    if(isAbsolute(value)||value.includes('/')||value.includes('\\'))return executable(value);
    for(const dir of directories)for(const name of process.platform==='win32'?[`${value}.exe`,value,`${value}.cmd`]:[value])if(await exists(join(dir,name)))return executable(join(dir,name));
    throw new Error('Configured Codex CLI was not found on PATH');
  }
  for(const dir of directories)for(const name of process.platform==='win32'?['codex.exe','codex.cmd','codex']:['codex'])if(await exists(join(dir,name)))return executable(join(dir,name));
  const installed=await installedCodex(env);if(installed)return executable(installed);
  throw new Error('Codex CLI is required on this computer; set DOTS_CODEX_CLI to its installed executable');
}
/** Codex uygulaması CLI'yi kendi klasörüne kurar; kullanıcının PATH'inde olmayabilir. */
async function installedCodex(env:NodeJS.ProcessEnv):Promise<string|undefined> {
  const base=env.LOCALAPPDATA?join(env.LOCALAPPDATA,'OpenAI','Codex','bin'):undefined;if(!base)return;
  const isWin=process.platform==='win32';
  let best:{file:string;time:number;hasHost:boolean}|undefined;
  try{for(const name of await readdir(base)){const file=join(base,name,isWin?'codex.exe':'codex'),host=join(base,name,isWin?'codex-code-mode-host.exe':'codex-code-mode-host');try{if(existsSync(file)){const hasHost=!isWin||existsSync(host),time=(await stat(file)).mtimeMs;if(!best||(hasHost&&!best.hasHost)||((hasHost===best.hasHost)&&time>best.time))best={file,time,hasHost};}}catch{}}}catch{}
  return best?.file;
}
function configText(base:string,model:string):string {
  return `# Managed by Dots worker. Provider secret is child environment only.\nmodel = ${JSON.stringify(model)}\nmodel_provider = "dots_worker"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n[model_providers.dots_worker]\nname = "Dots worker model proxy"\nbase_url = ${JSON.stringify(`${base}/worker/model`)}\nenv_key = "DOTS_WORKER_TOKEN"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\n[features]\napps = false\nplugins = false\nremote_plugin = false\nplugin_sharing = false\n[analytics]\nenabled = false\n[shell_environment_policy]\nexclude = ["DOTS_WORKER_TOKEN"]\n`;
}
function redactLog(value:string,token:string):string {
  return value.replaceAll(token,'[redacted]').replace(/\bBearer\s+[^\s"',]+/gi,'Bearer [redacted]').replace(/(authorization["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi,'$1[redacted]');
}
async function terminate(child:ChildProcess):Promise<void> {
  if(!child.pid||child.exitCode!==null||child.signalCode!==null)return;
  await new Promise<void>(resolve=>{
    let escalation:ReturnType<typeof setTimeout>|undefined,deadline:ReturnType<typeof setTimeout>|undefined;
    const done=()=>{if(escalation)clearTimeout(escalation);if(deadline)clearTimeout(deadline);child.off('close',done);resolve();};
    child.once('close',done);
    // Signal only the child we spawned, never a PID search or a user-owned server.
    child.kill('SIGTERM');
    escalation=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},2500);
    deadline=setTimeout(done,5000);
  });
}

export async function startManagedAppServer(options:ManagedAppServerOptions):Promise<ManagedAppServer> {
  const provided=options.appServerUrl??process.env.DOTS_WORKER_APPSERVER_URL;
  if(provided)return {url:suppliedUrl(provided),close:async()=>{}};
  const base=serverBase(options.server),token=required(options.workerToken,'worker token'),timeout=options.startupTimeoutMs??20_000;
  if(!Number.isFinite(timeout)||timeout<50||timeout>600_000)throw new Error('Startup timeout must be between 50 ms and 600 seconds');
  const home=await privateHome(options.dataDir),env=managedChildEnvironment(home,token,options.env);
  const cli=await resolveCli(options.childCLIPath,env);if(cli.prefix.length&&options.nodePath)cli.command=options.nodePath;
  const path=join(home,'config.toml'),temporary=join(home,`config.${randomUUID()}.tmp`);
  const text=configText(base,required(options.model??'gpt-6.1-sol','model'));
  // Refuse a config symlink before atomically replacing the managed file.
  if(await exists(path)){const existing=await realpath(path);if(!within(home,existing))throw new Error('Managed config must stay inside private Codex home');}
  await writeFile(temporary,text,{mode:0o600});await rename(temporary,path);await chmod(path,0o600);
  // Port zero is bound by Codex itself: no release/rebind race with another process.
  const child=spawn(cli.command,[...cli.prefix,'app-server','--listen','ws://127.0.0.1:0'],{cwd:home,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let failure:string|undefined,url:string|undefined,stdout='',stderr='',closed=false;
  child.once('error',()=>{failure='Unable to start the installed Codex CLI';});
  child.once('close',(code,signal)=>{closed=true;failure=`Worker Codex app-server exited before readiness (code ${code??'none'}, signal ${signal??'none'})`;});
  const consume=(chunk:Buffer,stream:'stdout'|'stderr')=>{
    let buffer=(stream==='stdout'?stdout:stderr)+chunk.toString('utf8');
    let index;
    while((index=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,index).replace(/\r$/,'');buffer=buffer.slice(index+1);
      // CLI 0.159.2 writes the listener banner to stderr; controlled Node
      // entrypoints can use stdout. Parse only a complete line, never half a port.
      const address=line.replace(/\x1b\[[0-9;]*m/g,'').match(/^\s*listening on:\s*(ws:\/\/127\.0\.0\.1:(\d+))\s*$/);
      if(!url&&address&&Number(address[2])>0&&Number(address[2])<=65535)url=address[1];
      try{options.onLog?.(redactLog(line,token));}catch{}
    }
    // Never flush a split secret; overlong unstructured log lines are discarded.
    if(buffer.length>65_536)buffer='';
    if(stream==='stdout')stdout=buffer;else stderr=buffer;
  };
  child.stdout?.on('data',(chunk:Buffer)=>consume(chunk,'stdout'));child.stderr?.on('data',(chunk:Buffer)=>consume(chunk,'stderr'));
  const deadline=Date.now()+timeout;
  try {
    while(Date.now()<deadline) {
      if(failure||closed)throw new Error(failure??'Worker Codex app-server closed before readiness');
      if(url) {
        const http=url.replace(/^ws:/,'http:');
        try {
          const remaining=Math.max(1,Math.min(1000,deadline-Date.now()));
          const probes=await Promise.all([fetch(`${http}/healthz`,{signal:AbortSignal.timeout(remaining),redirect:'error'}),fetch(`${http}/readyz`,{signal:AbortSignal.timeout(remaining),redirect:'error'})]);
          if(probes.every(response=>response.ok)) {
            if(closed||failure)throw new Error(failure??'Worker Codex app-server closed');
            let closing:Promise<void>|undefined;
            return {url,close:()=>closing??=terminate(child)};
          }
        }catch{}
      }
      await new Promise(resolve=>setTimeout(resolve,Math.min(50,Math.max(1,deadline-Date.now()))));
    }
    throw new Error('Worker Codex app-server did not become ready before startup timeout');
  }catch(error){await terminate(child);throw error;}
}
