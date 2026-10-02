import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {existsSync,readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {buildServer} from '../../server/src/app.js';
import {SqliteStore} from '../../server/src/storage.js';
import {dotBrowserSession} from '../../server/src/browser-session.js';
import {BrowserExecutor,browserExecutable} from '../src/browser.js';
import {BrowserStream} from '../src/stream.js';

// Resmi panelin kendi WebRTC istemcisi (kurulu uygulamadan çıkarılmış). Bulunamazsa test atlanır.
// Optional proprietary client assets are supplied by the tester, never redistributed in this repo.
const assets=process.env.DOTS_NATIVE_TEST_ASSETS||'';
const client=join(assets,'src-51803043763e.js');
const wait=async(fn:()=>boolean|Promise<boolean>,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100));}assert.ok(await fn(),'condition was not reached: '+fn.toString().slice(0,120));};

test('the official computer panel client streams the Dot browser and controls it through the data channel',{skip:!assets||!existsSync(client),timeout:120000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dots-stream-')),store=new SqliteStore(':memory:');
 const f=await buildServer({store,runner:{run:async()=>{throw new Error('No inference expected');}},config:{host:'127.0.0.1',port:0,dataDir:dir,adminKey:'test-key',signingKey:Buffer.alloc(32,1),modelBaseUrl:'http://localhost:10100/v1',modelApiKey:'',appServerUrl:'ws://localhost:9912',model:null,reasoningEffort:'high',serviceTier:null,workerOnlineMs:45000}});
 const executor=new BrowserExecutor(join(dir,'browser')),stream=new BrowserStream(executor);
 const site=createServer((req,res)=>{
  if(req.url==='/panel')return res.writeHead(200,{'content-type':'text/html'}).end('<video id="v" autoplay muted playsinline width="640"></video><script type="module">import {i as Client,t as init,n as Ev} from "/assets/src-51803043763e.js";await init();const c=new Client("/offer",null,(url,options)=>window.postOffer(options.body).then(text=>new Response(text)));c.addEventListener(Ev.STREAMING,s=>{document.getElementById("v").srcObject=s;});window.c=c;window.ready=true;</script>');
  if(req.url?.startsWith('/assets/')){try{return res.writeHead(200,{'content-type':'text/javascript'}).end(readFileSync(join(assets,req.url.slice(8))));}catch{return res.writeHead(404).end();}}
  res.writeHead(200,{'content-type':'text/html'}).end('<title>start</title><body style="margin:0;background:#2563eb"><input id="i" style="position:absolute;left:100px;top:100px;width:300px;height:50px;font-size:30px" oninput="document.title=\'typed:\'+this.value"><button style="position:absolute;left:100px;top:200px;width:200px;height:80px" onclick="document.title=\'clicked\'">OK</button></body>');
 });
 await new Promise<void>(r=>site.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+(site.address() as any).port;
 await f.app.listen({host:'127.0.0.1',port:0});const api='http://127.0.0.1:'+(f.app.server.address() as any).port;
 const computer=f.workers.register({token:f.auth.enroll('worker').token,name:'PC',platform:'test',roots:[dir],capabilities:['codex','browser']});
 const dot=f.runtime.createDot({name:'Genius',computerId:computer.computerId}),blankDot=f.runtime.createDot({name:'Empty',computerId:computer.computerId});
 let stopped=false;const pump=(async()=>{while(!stopped){const job=f.workers.next(computer.computerId);if(job){void(async()=>{try{const result=job.kind==='stream'?await stream.offer(job.payload as any):await executor.execute(job.payload as any,(job.payload as any).actor||'user');f.workers.finish(computer.computerId,job.id,result);}catch(error){f.workers.finish(computer.computerId,job.id,null,(error as Error).message);}})();}await new Promise(r=>setTimeout(r,25));}})();
 const token=f.auth.nativeTokens('panel').access_token,sessionOf=(id:string)=>dotBrowserSession(store,id,computer.computerId).sessionId;
 const browser=await chromium.launch({headless:true,executablePath:await browserExecutable(),args:['--autoplay-policy=no-user-gesture-required']});
 async function panel(id:string){
  const page=await browser.newPage();
  await page.exposeFunction('postOffer',async(sdp:string)=>{const r=await fetch(api+'/backend-api/tbo/'+id+'/computer/sessions?thread_id=t',{method:'POST',headers:{'content-type':'application/sdp',authorization:'Bearer '+token},body:sdp});assert.equal(r.status,200,await r.clone().text());assert.match(r.headers.get('content-type')||'',/application\/sdp/);return r.text();});
  await page.route('**/*',route=>route.request().url().startsWith('http://panel.test')?route.fulfill({status:200,contentType:'text/html',body:''}):route.continue());
  await page.goto(base+'/panel');await page.waitForFunction(()=>(window as any).ready===true);
  await page.evaluate(()=>(window as any).c.connect(20000));
  await page.waitForFunction(()=>{const v=document.getElementById('v') as HTMLVideoElement;return v.videoWidth===1280&&v.readyState>=2;},undefined,{timeout:20000}).catch(async error=>{console.log('DEBUG',JSON.stringify(await page.evaluate(()=>{const v=document.getElementById('v') as HTMLVideoElement,c=(window as any).c,pc=c.peerConnection;return {video:[v.videoWidth,v.readyState,!!v.srcObject,v.paused],tracks:v.srcObject?(v.srcObject as MediaStream).getTracks().map(t=>[t.kind,t.readyState,t.muted]):null,conn:pc?.connectionState,ice:pc?.iceConnectionState,mode:c.mode};})));throw error;});
  return page;
 }
 const pixel=(page:any,x:number,y:number)=>page.evaluate(([x,y]:number[])=>{const v=document.getElementById('v') as HTMLVideoElement,c=document.createElement('canvas');c.width=1280;c.height=800;const g=c.getContext('2d')!;g.drawImage(v,0,0);return Array.from(g.getImageData(x,y,1,1).data);},[x,y]);
 try{
  const session=sessionOf(dot.id);
  await executor.execute({action:'open',sessionId:session,url:base+'/'},'agent');
  const view=await panel(dot.id);
  await wait(async()=>{const [r,g,b]=await pixel(view,900,600);return b>170&&r<90&&g<140;});
  await view.evaluate(()=>(window as any).c.setMode('control'));
  await wait(()=>executor.control(session)==='user');
  await assert.rejects(executor.execute({action:'navigate',sessionId:session,url:base+'/'},'agent'),/user control/);
  const send=(kind:string,data:unknown)=>view.evaluate(([k,d])=>(window as any).c.sendData(k,d),[kind,data] as [string,unknown]);
  await send('mousemove',{x:150,y:240});await send('mousedown',{key:1});await send('mouseup',{key:1});
  await wait(async()=>(await executor.attach(session)).page.title().then(t=>t==='clicked'));
  await send('mousemove',{x:200,y:125});await send('mousedown',{key:1});await send('mouseup',{key:1});
  for(const keysym of [97,0xe7]){await send('keydown',{key:keysym});await send('keyup',{key:keysym});}
  await wait(async()=>(await executor.attach(session)).page.title().then(t=>t==='typed:aç'));
  await view.evaluate(()=>(window as any).c.setMode('observe'));
  await wait(()=>executor.control(session)==='agent');
  await executor.execute({action:'navigate',sessionId:session,url:base+'/'},'agent');
  // Dot kapatınca panel donmuş kareyi değil boş durumu göstermeli; yeniden açınca yeni sayfaya geçmeli.
  await executor.execute({action:'navigate',sessionId:session,url:base+'/'},'agent');
  await wait(async()=>{const [r,g,b]=await pixel(view,900,600);return b>170&&r<90&&g<140;});
  await executor.execute({action:'close',sessionId:session},'agent');
  await wait(async()=>{const [r,g,b]=await pixel(view,900,600);return r<40&&g<45&&b<60;});
  await executor.execute({action:'open',sessionId:session,url:base+'/'},'agent');
  await wait(async()=>{const [r,g,b]=await pixel(view,900,600);return b>170&&r<90&&g<140;});
  await executor.execute({action:'close',sessionId:session},'agent');
  await view.evaluate(()=>(window as any).c.disconnect());
  await wait(()=>stream.activeCount===0);
  // Kapatılmış site, panel yeniden bağlanınca geri açılmamalı.
  const reopened=await panel(dot.id);
  await wait(async()=>{const [r,g,b]=await pixel(reopened,900,600);return r<40&&g<45&&b<60;});
  assert.equal((await executor.attach(session)).page.url(),'about:blank');
  await reopened.evaluate(()=>(window as any).c.disconnect());
  await wait(()=>stream.activeCount===0);

  const empty=await panel(blankDot.id);
  await wait(async()=>{const [r,g,b]=await pixel(empty,20,20);return r<40&&g<45&&b<60;});
  await empty.evaluate(()=>(window as any).c.disconnect());await wait(()=>stream.activeCount===0);
  const other=await fetch(api+'/backend-api/tbo/'+dot.id+'/computer/sessions',{method:'POST',headers:{'content-type':'application/sdp',authorization:'Bearer '+token},body:'not an offer'});assert.equal(other.status,400);
  assert.equal((await fetch(api+'/backend-api/tbo/'+dot.id+'/computer/sessions',{method:'POST',headers:{'content-type':'application/sdp'},body:'v=0'})).status,401);
 }finally{stopped=true;await pump;await browser.close();await stream.close();await executor.close();await f.app.close();await new Promise<void>(r=>site.close(()=>r()));await rm(dir,{recursive:true,force:true});}
});
