
'use strict';
const fs=require('fs'),path=require('path'),net=require('net'),http=require('http'),https=require('https'),crypto=require('crypto'),{spawn}=require('child_process'),{homedir}=require('os');
const dir=process.env.DOTS_LOCAL_BRIDGE_DIR||path.join(homedir(),'.codex','dots-local-bridge');
const config=JSON.parse(fs.readFileSync(path.join(dir,'config.json'),'utf8').replace(/^\uFEFF/,''));
const token=fs.readFileSync(path.join(dir,'token.txt'),'utf8').trim();
const localPort=Number(config.localPort||9915),remotePort=Number(config.remotePort||9914);
if([localPort,remotePort].some(p=>!Number.isInteger(p)||p<1||p>65535))throw new Error('Invalid bridge port');
if(typeof config.sshHost!=='string'||!config.sshHost||config.sshHost.startsWith('-')||/[\s\r\n]/.test(config.sshHost))throw new Error('Configure an existing SSH host alias');
if(token.length<32)throw new Error('Bridge token is too short');
const gatewayUrl=new URL(config.nativeGateway);
if(gatewayUrl.protocol!=='https:'||!['localhost','127.0.0.1','[::1]'].includes(gatewayUrl.hostname)||gatewayUrl.username||gatewayUrl.password)throw new Error('Native gateway must use local HTTPS');
const allowed=new Set(['list_projects','list_threads','read_thread','create_thread','send_message_to_thread','wait_threads']);
const log=text=>{try{const f=path.join(dir,'bridge.log');if(fs.existsSync(f)&&fs.statSync(f).size>262144)fs.writeFileSync(f,'');fs.appendFileSync(f,new Date().toISOString()+' '+text+'\n');}catch{}};
let pipe=config.pipePath;
async function senderThread(sender){
 if(typeof sender?.dotId!=='string'||typeof sender?.threadId!=='string')throw new Error('Dot sender identity is required');
 if(!config.nativeGateway||!config.certificate)throw new Error('Dot sender verification is not configured');
 const dot=await new Promise((resolve,reject)=>{
  const ca=fs.readFileSync(config.certificate);
  const req=https.get(config.nativeGateway+'/backend-api/tbo/by-thread/'+encodeURIComponent(sender.threadId),{ca},res=>{
   let text='';res.on('data',data=>text+=data);
   res.on('end',()=>{if(res.statusCode!==200){reject(new Error('Dot sender thread could not be verified'));return;}try{resolve(JSON.parse(text));}catch(e){reject(e);}});
  });
  req.on('error',reject);req.setTimeout(8000,()=>req.destroy(new Error('Dot sender verification timed out')));
 });
 if(dot.id!==sender.dotId)throw new Error('Sender thread belongs to a different Dot');
 return sender.threadId;
}
function requestPipe(pipePath,method,params){
 return new Promise((resolve,reject)=>{
  const socket=net.connect(pipePath);let data=Buffer.alloc(0);const timer=setTimeout(()=>finish(new Error('Codex uygulaması cevap vermedi')),method==='tools/list'?1500:70000);
  const finish=(error,value)=>{clearTimeout(timer);socket.destroy();error?reject(error):resolve(value);};
  socket.on('error',e=>finish(e));
  socket.on('connect',()=>{const p=Buffer.from(JSON.stringify({id:1,jsonrpc:'2.0',method,params}));const h=Buffer.alloc(4);h.writeUInt32LE(p.length);socket.write(Buffer.concat([h,p]));});
  socket.on('data',chunk=>{data=Buffer.concat([data,chunk]);if(data.length<4)return;const n=data.readUInt32LE();if(n>8*1024*1024){finish(new Error('Yanıt fazla büyük'));return;}if(data.length<n+4)return;try{const m=JSON.parse(data.subarray(4,n+4));m.error?finish(new Error(m.error.message)):finish(null,m.result);}catch(e){finish(e);}});
 });
}
async function resolvePipe(){
 if(pipe){try{await requestPipe(pipe,'tools/list',{threadStartKind:'all'});return pipe;}catch{pipe=null;}}
 const names=fs.readdirSync('\\\\.\\pipe\\').filter(n=>n.startsWith('codex-browser-use-')).reverse();
 for(const name of names){
  try{const candidate='\\\\.\\pipe\\'+name;
   const result=await requestPipe(candidate,'tools/list',{threadStartKind:'all'});
   if(result.tools?.some(t=>t.name==='list_threads'&&t.namespace==='codex_app')){pipe=candidate;return pipe;}
  }catch{}
 }
 throw new Error('Yerel Codex uygulaması kapalı veya sohbet bağlantısı hazır değil.');
}
let active=0;
const server=http.createServer(async(req,res)=>{
 const respond=(status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(body));};
 const digest=x=>crypto.createHash('sha256').update(x).digest();
 const given=(req.headers.authorization||'').replace(/^Bearer /,'');
 if(!given||!crypto.timingSafeEqual(digest(given),digest(token)))return respond(401,{error:'Unauthorized'});
 if(req.method!=='POST'||req.url!=='/call')return respond(404,{error:'Not found'});
 if(active>=8)return respond(429,{error:'Too many requests'});
 active++;let text='';
 try{
  for await(const chunk of req){text+=chunk.toString();if(text.length>256000)throw new Error('İstek fazla büyük');}
  const body=JSON.parse(text);
  if(!allowed.has(body.tool))return respond(403,{error:'Tool not allowed'});
  const args=body.arguments||{};
  const callerThreadId=await senderThread(body.sender);
  // Local access may never redirect work to a different host/cloud through this bridge.
  if(args.hostId&&args.hostId!=='local')return respond(403,{error:'Only local chats are allowed here'});
  if(body.tool==='wait_threads'&&(!Array.isArray(args.targets)||args.targets.some(t=>t.hostId!=='local')))return respond(403,{error:'Only local chats are allowed here'});
  if(body.tool==='create_thread'&&(args.target?.type!=='project'||args.target.environment?.type!=='local'))return respond(403,{error:'Only existing local projects are allowed'});
  if(body.tool==='create_thread'){
   const p=await requestPipe(await resolvePipe(),'tools/call',{arguments:{},callerSource:'codex',callId:'dots-check-'+crypto.randomUUID(),hostId:'local',namespace:'codex_app',threadId:callerThreadId,turnId:'dots-'+crypto.randomUUID(),tool:'list_projects'});
   const content=p.contentItems?.find(x=>x.type==='inputText')?.text;
   const projects=JSON.parse(content||'{}').projects||[];
   if(!projects.some(p=>p.projectId===args.target.projectId&&p.hostId==='local'))return respond(403,{error:'Project is not on the local PC'});
  }
  const result=await requestPipe(await resolvePipe(),'tools/call',{arguments:args,callerSource:'codex',callId:'dots-local-'+crypto.randomUUID(),hostId:'local',namespace:'codex_app',threadId:callerThreadId,turnId:'dots-'+crypto.randomUUID(),tool:body.tool});
  respond(200,result);
 }catch(e){respond(502,{error:String(e.message).slice(0,400)});}finally{active--;}
});
server.headersTimeout=5000;server.requestTimeout=10000;
server.on('error',e=>{log(e.message);process.exit(1)});
let ssh,closing=false,retry;
function connectTunnel(){
 if(closing)return;
 ssh=spawn(config.sshExecutable||'ssh',['-N','-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-R','127.0.0.1:'+remotePort+':127.0.0.1:'+localPort,config.sshHost],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 ssh.stderr.on('data',d=>log(String(d).trim().slice(0,300)));
 ssh.on('error',e=>log(e.message));ssh.on('close',()=>{if(!closing)retry=setTimeout(connectTunnel,10000);});
}
server.listen(localPort,'127.0.0.1',()=>{log('Local bridge listening on 127.0.0.1:'+localPort);connectTunnel();});
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{closing=true;clearTimeout(retry);ssh?.kill();server.close();process.exit(0)});
