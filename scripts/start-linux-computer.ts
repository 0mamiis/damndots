import {DISTRO} from './linux-computer/distro.mjs';
import {spawn,execFile,type ChildProcess} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {acquireLaunchLock} from '../apps/client/src/launch-policy.js';

const run=promisify(execFile),root=resolve(import.meta.dirname,'..'),dir=join(root,'.data/linux-computer');
const profile=process.env.DOTS_LINUX_CONNECTION_ID||'local';if(!/^[A-Za-z0-9-]+$/.test(profile))throw Error('Invalid Linux connection profile');
const linuxData=profile==='local'?'/home/dot/.dots':'/home/dot/.dots/hosts/'+profile;
const relayPort=Number(process.env.DOTS_LINUX_RELAY_PORT||9340);if(!Number.isInteger(relayPort)||relayPort<1024||relayPort>65535)throw Error('Invalid Linux relay port');
await mkdir(dir,{recursive:true});
const release=await acquireLaunchLock(join(dir,'launcher.lock'));
if(!release){console.log('Linux computer launcher already running.');process.exit(0);}
let tunnel:ChildProcess|undefined,worker:ChildProcess|undefined,closing:Promise<void>|undefined;
async function close(){
 if(closing)return closing;
 closing=(async()=>{
  if(worker&&worker.exitCode===null){
   const done=new Promise<void>(r=>worker!.once('exit',()=>r()));
   worker.stdin?.end();
   await Promise.race([done,new Promise(r=>setTimeout(r,5000))]);
   if(worker.exitCode===null)worker.kill();
  }
  tunnel?.kill();await release();
 })();return closing;
}
for(const sig of ['SIGINT','SIGTERM'] as const)process.once(sig,()=>{void close().then(()=>process.exit(0));});
const parent=Number(process.env.DOTS_LINUX_PARENT_PID);
const watch=parent?setInterval(()=>{try{process.kill(parent,0);}catch{void close().then(()=>process.exit(0));}},1500):undefined;
async function writeConfig(value:unknown,file:'runtime'|'computer'='runtime'){
 const p=spawn('wsl.exe',['-d',DISTRO,'-u','dot','--exec','sh','-c','umask 077; mkdir -p '+linuxData+'; cat >'+linuxData+'/'+file+'.json'],{windowsHide:true,stdio:['pipe','ignore','pipe']});
 p.stdin.end(JSON.stringify(value));const code=await new Promise(r=>{p.once('exit',r);p.once('error',()=>r(-1));});
 if(code!==0)throw Error('Linux runtime configuration failed');
}
try{
 await run('wsl.exe',['-d',DISTRO,'-u','root','--exec','sh','-c','mkdir -p /run/sshd; pgrep -x sshd >/dev/null || /usr/sbin/sshd'],{windowsHide:true});
 tunnel=spawn('ssh.exe',['-F','NUL','-N','-T','-i',join(dir,'ssh/id_ed25519'),'-p','22444','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+join(dir,'ssh/known_hosts'),'-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=10','-o','ServerAliveCountMax=3','-R','127.0.0.1:19340:127.0.0.1:'+relayPort,'dot@127.0.0.1'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 let failure='';tunnel.stderr?.on('data',b=>{console.error('Linux tunnel: '+b.toString().trim());});tunnel.on('error',e=>{failure=e.message;});
 let connected=false;
 for(let n=0;n<40;n++){
  if(tunnel.exitCode!==null||failure)throw Error('Linux tunnel stopped: '+(failure||tunnel.exitCode));
  try{const r=await run('wsl.exe',['-d',DISTRO,'-u','dot','--exec','curl','--silent','--fail','--max-time','2','http://127.0.0.1:19340/health'],{windowsHide:true});if(r.stdout.includes('ok')){connected=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,250));
 }
 if(!connected)throw Error('Linux could not connect to the local Dots server');
 let credentials:any;try{credentials=JSON.parse((await run('wsl.exe',['-d',DISTRO,'-u','dot','--exec','cat',linuxData+'/computer.json'],{windowsHide:true})).stdout);}catch{}
 if(process.env.DOTS_LINUX_CREDENTIALS){credentials={...JSON.parse(process.env.DOTS_LINUX_CREDENTIALS),server:'http://127.0.0.1:19340'};await writeConfig(credentials,'computer');}
 if(credentials?.server==='http://127.0.0.1:9340'){credentials.server='http://127.0.0.1:19340';await writeConfig(credentials,'computer');}
 if(!credentials){
  const admin=process.env.DOTS_ADMIN_KEY||(await readFile(join(root,'apps/server/.data/server/admin.key'),'utf8')).trim(),base=process.env.DOTS_SERVER_URL||'http://127.0.0.1:9340';
  const loginResponse=await fetch(base+'/api/v1/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:admin})});if(!loginResponse.ok)throw Error('Linux enrollment login rejected');
  const login=await loginResponse.json(),r=await fetch(base+'/api/v1/computers/enrollment',{method:'POST',headers:{authorization:'Bearer '+login.accessToken}});
  if(!r.ok)throw Error('Linux enrollment rejected');await writeConfig({server:'http://127.0.0.1:19340',enrollment:(await r.json()).token});
 }
 let centralModel='anthropic/claude-sonnet-5-5';
 try{const text=await readFile(join(root,'.data/local-stack/codex-home/config.toml'),'utf8'),value=text.match(/^model\s*=\s*("[^"]+")/m)?.[1];if(value)centralModel=JSON.parse(value);}catch{}
 let runtime:any={};try{runtime=JSON.parse((await run('wsl.exe',['-d',DISTRO,'-u','dot','--exec','cat',linuxData+'/runtime.json'],{windowsHide:true})).stdout);}catch{}runtime.defaultModel=centralModel;runtime.server='http://127.0.0.1:19340';await writeConfig(runtime);
 worker=spawn('wsl.exe',['-d',DISTRO,'-u','dot','--cd','/opt/dots','--exec','env','DOTS_LINUX_DATA_DIR='+linuxData,'node','--import','tsx','scripts/linux-worker-entry.ts'],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
 worker.stdout?.on('data',b=>process.stdout.write(b));worker.stderr?.on('data',b=>process.stderr.write(b));
 tunnel.once('exit',()=>{void close();});
 console.log('Linux computer is connected through its private local tunnel.');
 process.exitCode=await new Promise<number>(r=>{worker!.once('exit',code=>r(code||0));worker!.once('error',e=>{console.error(e.message);r(1);});});
}finally{if(watch)clearInterval(watch);await close();}
