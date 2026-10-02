// The original CLI owns normal chats. Only Dot-owned read/resume requests use the Dots backend.
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import https from 'node:https';
import {WebSocket} from 'ws';
const manifest=JSON.parse(await readFile(process.argv[2],'utf8')),args=process.argv.slice(3);
const env={...process.env};delete env.CODEX_CLI_PATH;
const cli=spawn(manifest.realCli,args,{env,stdio:['pipe','pipe','pipe'],windowsHide:true});
cli.stderr.pipe(process.stderr);
// The real account reports chatgpt.com as its workspace backend, so the desktop app would send account, feature-flag and plugin
// requests straight there and bypass the Dots gateway. Pointing that origin at the gateway keeps one routing point;
// the gateway forwards everything that is not Dot-owned to the real service with the app's own credentials.
const gatewayOrigin=new URL(manifest.gateway).origin;
function routeThroughGateway(value){
 if(!value||typeof value!=='object')return false;
 let changed=false;
 const routing=value.workspaceRouting;
 if(routing&&typeof routing==='object'&&typeof routing.backendOrigin==='string'&&routing.backendOrigin!==gatewayOrigin){routing.backendOrigin=gatewayOrigin;changed=true;}
 for(const child of Object.values(value))if(child&&typeof child==='object'&&routeThroughGateway(child))changed=true;
 return changed;
}
createInterface({input:cli.stdout,terminal:false}).on('line',line=>{
 if(line.includes('workspaceRouting')){try{const message=JSON.parse(line);if(routeThroughGateway(message)){process.stdout.write(JSON.stringify(message)+'\n');return;}}catch{}}
 process.stdout.write(line+'\n');
});
const ca=await readFile(manifest.certificate),dotThreads=new Set(),pending=new Map();
let refreshed=0,remote,connecting,counter=0;
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
const get=path=>new Promise((resolve,reject)=>{https.get(manifest.gateway+path,{ca},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>res.statusCode===200?resolve(JSON.parse(text)):reject(Error('Dot lookup failed')));}).on('error',reject);});
async function refreshThreads(){
 if(Date.now()-refreshed<5000)return;
 const data=await get('/backend-api/tbo');
 for(const dot of data.items||[]){if(dot.root_thread_id)dotThreads.add(dot.root_thread_id);if(dot.active_root_thread_id)dotThreads.add(dot.active_root_thread_id);}
 refreshed=Date.now();
}
const allowed=new Set(['thread/read','thread/resume','thread/turns/list','thread/items/list','thread/name/set','thread/archive','thread/unarchive','turn/interrupt']);
async function connection(){
 if(remote?.readyState===WebSocket.OPEN)return remote;
 if(connecting)return connecting;
 connecting=new Promise((resolve,reject)=>{
  const socket=new WebSocket(manifest.gateway.replace(/^https:/,'wss:')+'/native/app-server',{ca});
  const initId='dots_bridge_init',timeout=setTimeout(()=>{socket.close();reject(Error('Dot RPC connection timed out'));},10000);
  socket.on('open',()=>setTimeout(()=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify({id:initId,method:'initialize',params:{clientInfo:{name:'dots_native_bridge',version:'1'},capabilities:{experimentalApi:true}}}));},300));
  socket.on('message',bytes=>{
   let message;try{message=JSON.parse(String(bytes));}catch{return;}
   if(message.id===initId){clearTimeout(timeout);if(message.error){reject(Error('Dot RPC initialization failed'));return;}socket.send(JSON.stringify({method:'initialized'}));remote=socket;resolve(socket);return;}
   if(pending.has(message.id)){const request=pending.get(message.id);pending.delete(message.id);clearTimeout(request.timeout);message.id=request.id;emit(message);}
   else if(message.method&&message.params?.threadId&&dotThreads.has(message.params.threadId))emit(message);
  });
  socket.on('error',()=>{clearTimeout(timeout);reject(Error('Dot RPC unavailable'));});
  socket.on('close',()=>{if(remote===socket)remote=undefined;for(const [id,p] of pending){clearTimeout(p.timeout);emit({id:p.id,error:{code:-32603,message:'Dot connection closed'}});pending.delete(id);}});
 }).finally(()=>{connecting=undefined;});
 return connecting;
}
async function route(line){
 let message;try{message=JSON.parse(line);}catch{cli.stdin.write(line+'\n');return;}
 if(message.id!==undefined&&allowed.has(message.method)&&typeof message.params?.threadId==='string'){
  try{await refreshThreads();}catch{}
  if(dotThreads.has(message.params.threadId)){
   try{const socket=await connection(),id='dots_bridge_'+(++counter);const timeout=setTimeout(()=>{pending.delete(id);emit({id:message.id,error:{code:-32603,message:'Dot RPC request timed out'}});},30000);pending.set(id,{id:message.id,timeout});const params=message.method==='thread/resume'?{threadId:message.params.threadId}:message.params;socket.send(JSON.stringify({...message,id,params}));}
   catch(error){process.stderr.write('Dot RPC: '+String(error.message)+'\n');emit({id:message.id,error:{code:-32603,message:'Dot backend is unavailable'}});}
   return;
  }
 }
 cli.stdin.write(line+'\n');
}
const input=createInterface({input:process.stdin,terminal:false});
input.on('line',line=>{void route(line);});
input.on('close',()=>{cli.stdin.end();remote?.close();});
cli.once('exit',code=>{remote?.close();process.exit(code||0);});
cli.once('error',()=>{process.stderr.write('Codex CLI bridge could not start the installed CLI.\n');process.exit(1);});
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{remote?.close();cli.kill();});
