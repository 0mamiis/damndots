import {spawn,execFile,type ChildProcess} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import net from 'node:net';
import https from 'node:https';
import type {HostPlan} from '../apps/server/src/connections.js';
import {WorkerRelay} from '../apps/client/src/worker-relay.js';
import {DISTRO} from './linux-computer/distro.mjs';
const run=promisify(execFile);
const open=(port:number)=>new Promise<boolean>(r=>{const s=net.connect(port,'127.0.0.1');s.once('connect',()=>{s.destroy();r(true);});s.once('error',()=>r(false));s.setTimeout(500,()=>{s.destroy();r(false);});});
export class ConnectionController {
 private session?:{accessToken:string;expiresAt:string};private timer?:ReturnType<typeof setInterval>;
 private busy=false;private closing=false;private applied?:HostPlan;private children=new Map<string,ChildProcess>();
 private installing=false;
 private relay:WorkerRelay;
 constructor(private root:string,private data:string,private localUrl:string,private adminKey:string,private appServerPort:number,private nativeDefault:boolean){this.relay=new WorkerRelay(localUrl,9352);}
 private async api(path:string,body?:unknown){
  if(!this.session||Date.parse(this.session.expiresAt)<Date.now()+60000){const r=await fetch(this.localUrl+'/api/v1/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:this.adminKey})});if(!r.ok)throw Error('Local controller authentication failed');this.session=await r.json();}
  const r=await fetch(this.localUrl+'/api/v1/connections'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+this.session!.accessToken,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(60000)});if(!r.ok){const e=await r.json().catch(()=>({}));throw Error(e.error||'Connection controller HTTP '+r.status);}return r.json();
 }
 private async file(path:string,value:unknown){await mkdir(join(path,'..'),{recursive:true});const temporary=path+'.tmp';await writeFile(temporary,JSON.stringify(value),{mode:0o600});await rename(temporary,path);}
 private async json(path:string){try{return JSON.parse(await readFile(path,'utf8'));}catch{return undefined;}}
 async start(){
  await this.relay.start();
  const options={nativeEnabled:this.nativeDefault&&!existsSync(join(this.data,'native/disabled')),workerEnabled:true,linuxEnabled:false,computerMode:'pc' as const,gatewayPort:Number(process.env.DOTS_NATIVE_PORT||8000),workerRoots:[process.env.DOTS_WORKSPACE||join(this.data,'workspace')]};
  const client=await this.json(join(this.data,'native/client.json'))||await this.json(join(this.data,'client-main/client.json'));
  const windows=await this.json(join(this.data,'worker/computer.json'));let linux:any;
  if(existsSync(join(this.root,'.data/linux-computer/enabled'))&&process.platform==='win32')try{linux=JSON.parse((await run('wsl.exe',['-d',DISTRO,'-u','dot','--exec','cat','/home/dot/.dots/computer.json'],{windowsHide:true})).stdout);}catch{}
  await this.api('/bootstrap',{options,client,windows,linux});
  const plan:HostPlan=await this.api('/runtime-plan');
  if(plan.id==='local'&&(!plan.client&&options.nativeEnabled||!plan.windows&&options.workerEnabled||!plan.linux&&options.linuxEnabled))await this.api('/local/activate',{});
  await this.tick();this.timer=setInterval(()=>void this.tick(),3000);
 }
 private startChild(kind:string,script:string,args:string[],env:NodeJS.ProcessEnv){const p=spawn(process.execPath,['--import','tsx',script,...args],{cwd:this.root,env:{...process.env,...env},windowsHide:true,stdio:'inherit'});this.children.set(kind,p);p.once('error',e=>console.error(kind+': '+e.message));p.once('exit',()=>{if(this.children.get(kind)===p)this.children.delete(kind);});return p;}
 private async stop(kind:string){const p=this.children.get(kind);if(!p)return;this.children.delete(kind);if(p.exitCode!==null)return;p.kill('SIGTERM');await new Promise<void>(r=>{const timer=setTimeout(r,6500);p.once('exit',()=>{clearTimeout(timer);r();});});}
 private async apply(plan:HostPlan){
  const sameHost=this.applied?.id===plan.id;
  await this.stop('windows');await this.stop('linux');
  if(!sameHost||this.applied?.options.gatewayPort!==plan.options.gatewayPort||!plan.options.nativeEnabled)await this.stop('native');
  this.relay.setTarget(plan.serverUrl);
  if(plan.options.nativeEnabled)await rm(join(this.data,'native/disabled'),{force:true});
  if(plan.client)await this.file(join(this.data,'native/connection-target.json'),{revision:plan.revision,serverUrl:plan.serverUrl,client:plan.client});
  const windowsDir=plan.id==='local'?join(this.data,'worker'):join(this.data,'host-workers',plan.id);
  if(plan.windows)await this.file(join(windowsDir,'computer.json'),{...plan.windows,server:plan.serverUrl});
  this.applied=plan;
 }
 private async ensure(plan:HostPlan){
  if(plan.options.workerEnabled&&!this.children.has('windows')){
   const workerData=plan.id==='local'?join(this.data,'worker'):join(this.data,'host-workers',plan.id);
   const args=['--server',plan.serverUrl,...plan.options.workerRoots.flatMap(r=>['--root',r])];
   this.startChild('windows','scripts/local-worker.ts',args,{DOTS_WORKER_DATA_DIR:workerData,DOTS_WORKER_SUPERVISOR_PID:String(process.pid),DOTS_WORKER_APPSERVER_URL:plan.id==='local'?'ws://127.0.0.1:'+this.appServerPort:undefined,DOTS_COMPUTER_MODE:'pc'});
  }
  if(plan.options.nativeEnabled&&process.platform==='win32'&&!this.children.has('native')&&!await open(plan.options.gatewayPort))this.startChild('native','scripts/native-dots.ts',[],{DOTS_SERVER_URL:plan.serverUrl,DOTS_NATIVE_PORT:String(plan.options.gatewayPort),DOTS_NATIVE_PARENT_PID:String(process.pid),DOTS_STACK_DIR:this.data});
  if(plan.options.linuxEnabled&&process.platform==='win32'&&!this.children.has('linux')){
   if(!existsSync(join(this.root,'.data/linux-computer/enabled')))throw Error('Önce Dot Linux bilgisayarını kurun.');
   this.startChild('linux','scripts/start-linux-computer.ts',[],{DOTS_LINUX_PARENT_PID:String(process.pid),DOTS_SERVER_URL:plan.serverUrl,DOTS_LINUX_CONNECTION_ID:plan.id,DOTS_LINUX_RELAY_PORT:'9352',DOTS_LINUX_CREDENTIALS:JSON.stringify(plan.linux)});
  }
 }
 private async tick(){if(this.busy||this.closing)return;this.busy=true;let plan:HostPlan|undefined,error:string|null=null;
  try{plan=await this.api('/runtime-plan');if(this.applied?.revision!==plan!.revision)await this.apply(plan!);await this.ensure(plan!);if(!this.installing){const job=await this.api('/setup-next',{});if(job)void this.install(job);}}catch(e){error=(e as Error).message;console.error('Connection controller: '+error);}
  try{if(plan){let nativeReady=false;try{const ca=await readFile(join(this.data,'native/certs/ca.pem'));const health:any=await new Promise((r,j)=>{const req=https.get('https://localhost:'+plan!.options.gatewayPort+'/health',{ca},response=>{let text='';response.on('data',b=>text+=b);response.on('end',()=>{try{r(JSON.parse(text));}catch(e){j(e);}});});req.on('error',j);req.setTimeout(1500,()=>req.destroy(Error('Native health timeout')));});nativeReady=health.server===plan.serverUrl&&health.clientId===plan.client?.clientId;}catch{}
   const workerReady=async(credential:any)=>{if(!credential?.token)return false;try{const r=await fetch(plan!.serverUrl+'/worker/status',{headers:{authorization:'Bearer '+credential.token},signal:AbortSignal.timeout(2000),redirect:'error'});return r.ok&&(await r.json()).state==='online';}catch{return false;}};
   await this.api('/heartbeat',{profileId:plan.id,revision:this.applied?.revision||'',nativeReady:plan.options.nativeEnabled&&nativeReady,workerReady:plan.options.workerEnabled&&this.children.has('windows')&&await workerReady(plan.windows),linuxReady:plan.options.linuxEnabled&&this.children.has('linux')&&await workerReady(plan.linux),error});}}
  catch{}finally{this.busy=false;}
 }
 private async install(job:any){this.installing=true;let error:string|null=null;try{
  if(process.platform!=='win32')throw Error('Linux kurulumu için Windows/WSL2 gerekir.');
  if(this.applied?.options.linuxEnabled)throw Error('Kurulumdan önce bilgisayar modunu PC olarak seçip uygula.');
  const p=spawn(process.execPath,['scripts/setup-linux-computer.mjs'],{cwd:this.root,windowsHide:true,env:{...process.env,DOTS_LINUX_DISTRO:job.distribution,DOTS_LINUX_IMAGE:job.kind==='custom'?job.imagePath:undefined,DOTS_LINUX_IMAGE_SHA256:job.sha256},stdio:['ignore','pipe','pipe']});let tail='';for(const s of [p.stdout,p.stderr])s?.on('data',b=>{tail=(tail+b.toString()).slice(-1800);});const code=await new Promise<number|null>((r,j)=>{p.once('error',j);p.once('exit',r);});if(code!==0)throw Error('Linux kurulumu tamamlanamadı: '+tail);
 }catch(e){error=(e as Error).message.slice(0,2000);}finally{try{await this.api('/setup/'+job.id,{status:error?'failed':'completed',error});}catch(e){console.error('Kurulum sonucu kaydedilemedi: '+(e as Error).message);}this.installing=false;}}
 async close(){this.closing=true;if(this.timer)clearInterval(this.timer);await this.stop('windows');await this.stop('linux');await this.stop('native');await this.relay.close();}
}
