import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import net from 'node:net';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {acquireLaunchLock} from '../apps/client/src/launch-policy.js';
import {ConnectionController} from './connection-controller.js';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const data=resolve(process.env.DOTS_STACK_DIR||join(root,'.data/local-stack'));await mkdir(data,{recursive:true});
if(process.argv.includes('--launch')||process.argv.includes('--main-profile'))throw new Error('Bu betik yalnızca servis başlatır. Codex uygulaması masaüstündeki Codex simgesinden açılır.');
const serverPort=Number(process.env.DOTS_PORT||9340),appServerPort=Number(process.env.DOTS_APPSERVER_PORT||9912),dashboardPort=Number(process.env.DOTS_DASHBOARD_PORT||4320),mainGateway=process.argv.includes('--main-gateway'),clientPort=Number(process.env.DOTS_CLIENT_PORT||(mainGateway?8002:8001));
const open=(port:number)=>new Promise<boolean>(r=>{const s=net.connect(port,'127.0.0.1');s.once('connect',()=>{s.destroy();r(true);});s.once('error',()=>r(false));s.setTimeout(500,()=>{s.destroy();r(false);});});
const ports=[['sunucu',serverPort],['app-server',appServerPort],['panel',dashboardPort]] as [string,number][];
const unavailable=async()=>{const status=await Promise.all(ports.map(async([name,port])=>await open(port)?null:`${name} (${port})`));return status.filter((s):s is string=>s!==null);};
const release=await acquireLaunchLock(join(data,'services.lock'));
if(!release){
  const missing=await unavailable();
  if(missing.length)console.log('Dots başlatma süreci açık, ancak henüz hazır olmayan servisler var: '+missing.join(', ')+'. Başlatma konsolundaki hata satırlarını kontrol edin.');
  else console.log(`Dots servisleri zaten çalışıyor. Panel: http://127.0.0.1:${dashboardPort}. Codex penceresinin kapalı olması servisleri durdurmaz.`);
  process.exit(0);
}
process.once('exit',()=>{void release();});
const children:ReturnType<typeof spawn>[]=[];
const start=(script:string,args:string[],extra:NodeJS.ProcessEnv={})=>{const child=spawn(process.execPath,['--import','tsx',script,...args],{cwd:root,env:{...process.env,...extra},stdio:'inherit',windowsHide:true});children.push(child);child.once('error',e=>console.error(e.message));return child;};
const url=`http://127.0.0.1:${serverPort}`,serverData=resolve(process.env.DOTS_DATA_DIR||join(root,'apps/server/.data/server'));
if(!await open(appServerPort))start('scripts/appserver.ts',[],{DOTS_APPSERVER_LISTEN:`ws://127.0.0.1:${appServerPort}`,DOTS_CODEX_HOME:join(data,'codex-home'),DOTS_DATA_DIR:serverData,DOTS_SERVER_URL:url,DOTS_MODEL:process.env.DOTS_MODEL||'anthropic/claude-sonnet-5-5'});
if(!await open(serverPort))start('apps/server/src/index.ts',[],{DOTS_DATA_DIR:serverData,DOTS_PORT:String(serverPort),DOTS_APPSERVER_URL:`ws://127.0.0.1:${appServerPort}`,DOTS_MODEL:process.env.DOTS_MODEL||'anthropic/claude-sonnet-5-5',DOTS_REASONING_EFFORT:'high',...process.env.DOTS_SERVICE_TIER?{DOTS_SERVICE_TIER:process.env.DOTS_SERVICE_TIER}:{}});
for(let i=0;i<100;i++){try{if((await fetch(url+'/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
for(let i=0;i<120&&!await open(appServerPort);i++)await new Promise(r=>setTimeout(r,250));
if(!await open(appServerPort))console.error('UYARI: Codex app-server başlamadı ('+appServerPort+'). Dot paneli "Couldn\'t load your dot" verir. Yukarıdaki hata satırına bakın veya DOTS_CODEX_CLI değişkenini codex.exe yoluna ayarlayın.');
const admin=process.env.DOTS_ADMIN_KEY||(await readFile(join(serverData,'admin.key'),'utf8')).trim();const login=await fetch(url+'/api/v1/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:admin})});if(!login.ok)throw new Error('Existing server uses a different data directory/access key; configure DOTS_DATA_DIR');const session=await login.json();
const controller=new ConnectionController(root,data,url,admin,appServerPort,mainGateway&&process.platform==='win32');
await controller.start();
if(!await open(dashboardPort)){const script=join(root,'apps/dashboard/scripts/start.mjs');start(script,['--port',String(dashboardPort)]);}
await writeFile(join(data,'processes.json'),JSON.stringify(children.map(c=>({pid:c.pid,startedAt:new Date().toISOString()}))),{mode:0o600});
for(const sig of ['SIGINT','SIGTERM'] as const)process.once(sig,()=>{void controller.close().then(()=>{for(const c of children)c.kill();void release();});});
let missing=await unavailable();
for(let i=0;i<80&&missing.length;i++){await new Promise(r=>setTimeout(r,250));missing=await unavailable();}
if(missing.length)console.error('Dots açılışı tamamlanamadı. Hazır olmayan servisler: '+missing.join(', '));
else console.log(`Dots servisleri hazır. Panel: http://127.0.0.1:${dashboardPort}. Codex penceresi açılmadı.`);
