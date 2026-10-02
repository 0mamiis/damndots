import https from 'node:https';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import {gatewayCertificates} from './certificates.js';
import {readNativeIdentity,nativeIdentityRoute,projectNativeIdentity} from './native-identity.js';
import {isDotsRoute,isLocalFirstRoute,isStatsigRoute,isAccountCheckRoute,mergeStatsig,enableDotsAccount} from './native-upstream.js';
interface Tokens {access_token:string;id_token:string;refresh_token:string;}
export interface ClientState {clientId:string;server:string;tokens:Tokens;}
export interface GatewayOptions {server:string;enrollment?:string;dataDir:string;codexHome?:string;port?:number;appServerPort?:number;writeCodexProfile?:boolean;identityHome?:string;upstream?:string;logFile?:string;trace?:boolean;}
export class NativeGateway {
  state:ClientState|undefined;
  server:https.Server|undefined;
  private wsServer=new WebSocketServer({noServer:true});
  private refreshPromise:Promise<void>|undefined;
  constructor(readonly options:GatewayOptions){const u=new URL(options.server);if(u.username||u.password||(!['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&u.protocol!=='https:'))throw new Error('Remote server requires HTTPS or a local SSH tunnel');}
  private async save(){await writeFile(join(this.options.dataDir,'client.json'),JSON.stringify(this.state,null,2),{mode:0o600});if(this.options.writeCodexProfile===false)return;const codexHome=(this.options.codexHome??join(this.options.dataDir,'codex-home'));await mkdir(codexHome,{recursive:true});await writeFile(join(codexHome,'auth.json'),JSON.stringify({auth_mode:'chatgpt',OPENAI_API_KEY:null,tokens:{...this.state!.tokens,account_id:'acct_local_orbit'},last_refresh:new Date().toISOString()}),{mode:0o600});
    const configFile=join(codexHome,'config.toml');let config='';try{config=await readFile(configFile,'utf8');}catch{}const port=this.options.port||8000;const lines=[`chatgpt_base_url = "https://localhost:${port}/backend-api"`,`openai_base_url = "https://localhost:${port}/backend-api/codex"`];config=config.replace(/^\s*(?:chatgpt_base_url|openai_base_url)\s*=.*\r?\n/gm,'');await writeFile(configFile,lines.join('\n')+'\n'+config,{mode:0o600});}
  async enroll(){await mkdir(this.options.dataDir,{recursive:true});try{const s=JSON.parse(await readFile(join(this.options.dataDir,'client.json'),'utf8'));if(s.server===this.options.server)this.state=s;}catch{}
    if(!this.state){if(!this.options.enrollment)throw new Error('Enroll client using a dashboard client enrollment token');const r=await fetch(new URL('/client/enroll',this.options.server),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:this.options.enrollment}),redirect:'error'});if(!r.ok)throw new Error('Client enrollment rejected: '+r.status);this.state={...await r.json(),server:this.options.server};}await this.save();}
  async refresh(){if(this.refreshPromise)return this.refreshPromise;this.refreshPromise=(async()=>{const r=await fetch(new URL('/auth/oauth/token',this.options.server),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({grant_type:'refresh_token',refresh_token:this.state!.tokens.refresh_token}),redirect:'error'});if(!r.ok)throw new Error('Client token refresh rejected: '+r.status);this.state!.tokens=await r.json();await this.save();})().finally(()=>this.refreshPromise=undefined);return this.refreshPromise;}
  private async access(){const claims=JSON.parse(Buffer.from(this.state!.tokens.access_token.split('.')[1],'base64url').toString());if(claims.exp*1000<Date.now()+60000)await this.refresh();return this.state!.tokens.access_token;}
  private async snapshotAccess(state:ClientState,server:string){const c=JSON.parse(Buffer.from(state.tokens.access_token.split('.')[1],'base64url').toString());if(c.exp*1000<Date.now()+60000){const r=await fetch(new URL('/auth/oauth/token',server),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({grant_type:'refresh_token',refresh_token:state.tokens.refresh_token}),redirect:'error'});if(!r.ok)throw Error('Client refresh rejected');state.tokens=await r.json();if(this.state===state)await this.save();}return state.tokens.access_token;}
  async changeConnection(server:string,state:ClientState){
    const u=new URL(server);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!['http:','https:'].includes(u.protocol)||u.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||state.server!==u.origin)throw Error('Invalid native connection target');
    if(!state.clientId||!state.tokens?.access_token||!state.tokens?.refresh_token)throw Error('Native client credentials missing');
    for(const ws of this.wsServer.clients)ws.close(1012,'Dot host changed');
    this.refreshPromise=undefined;this.options.server=u.origin;this.state=structuredClone(state);await this.save();
  }
  async certificates(){return gatewayCertificates(join(this.options.dataDir,'certs'));}
  async start(){await this.enroll();const tls=await this.certificates();const port=this.options.port||8000;
    this.server=https.createServer({key:tls.key,cert:tls.cert},async(req,res)=>{try{
      if(req.url==='/health'&&req.method==='GET'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({ok:true,service:'dots-native-gateway',clientId:this.state!.clientId,server:this.options.server}));return;}
      const connectionServer=this.options.server,connectionState=this.state!;
      const url=new URL(req.url||'/',connectionServer);if(!(url.pathname.startsWith('/backend-api/')||url.pathname.startsWith('/auth/'))){res.writeHead(404);res.end();return;}
      const buffers:Buffer[]=[];let size=0;for await(const piece of req){size+=piece.length;if(size>48*1024*1024)throw new Error('Request too large');buffers.push(piece);}
      const payload=['GET','HEAD'].includes(req.method||'GET')?undefined:Buffer.concat(buffers),appAuthorization=req.headers.authorization;
      const base=new Headers();for(const [key,value] of Object.entries(req.headers))if(value!==undefined&&!['host','connection','content-length','cookie','authorization','proxy-authorization','accept-encoding'].includes(key))base.set(key,Array.isArray(value)?value.join(','):value);
      const toDots=async()=>{const headers=new Headers(base);headers.set('authorization','Bearer '+await this.snapshotAccess(connectionState,connectionServer));headers.set('x-dots-client-capabilities','browser-viewer-v1');return fetch(url,{method:req.method,headers,body:payload,redirect:'error'});};
      const toReal=()=>{const headers=new Headers(base);if(appAuthorization)headers.set('authorization',appAuthorization);return fetch(new URL(url.pathname+url.search,this.options.upstream),{method:req.method,headers,body:payload,redirect:'manual'});};
      const headersOf=(response:Response)=>{const out:Record<string,string>={};response.headers.forEach((v,k)=>{if(!['content-length','transfer-encoding','content-encoding','connection','set-cookie'].includes(k))out[k]=v;});return out;};
      const sendJson=(response:Response,body:unknown)=>{res.writeHead(response.status,headersOf(response));res.end(JSON.stringify(body));};
      const localDownload=(body:any)=>{const download=new URL(body.download_url);body.download_url=`https://localhost:${port}${download.pathname}${download.search}`;return body;};
      if(this.options.trace)this.log('request '+req.method+' '+url.pathname);if(this.options.trace&&/voice|realtime|settings/.test(url.pathname)&&payload){this.log('BODY '+url.pathname+' ct='+req.headers['content-type']+' '+payload.toString('utf8').replace(/a=[^\r\n]*|[a-z]=[^\r\n]{0,0}/g,'').slice(0,500).replace(/\s+/g,' '));}
      let response:Response;const real=!!this.options.upstream&&url.pathname.startsWith('/backend-api/')&&!isDotsRoute(url.pathname);
      if(real&&isStatsigRoute(req.method,url.pathname)){
        // The real account keeps its own feature flags; Dots adds the few flags its screens need.
        const [realResponse,localResponse]=await Promise.allSettled([toReal(),toDots()]);
        if(realResponse.status==='fulfilled'&&realResponse.value.ok&&localResponse.status==='fulfilled'&&localResponse.value.ok){
          const merged=mergeStatsig(await realResponse.value.clone().json().catch(()=>undefined),await localResponse.value.clone().json().catch(()=>undefined));
          this.log('statsig '+(merged?'merged real+dots':'incompatible; using real flags only'));
          if(merged){sendJson(realResponse.value,merged);return;}
          response=realResponse.value;
        }else if(realResponse.status==='fulfilled'){this.log('statsig real only status '+realResponse.value.status);response=realResponse.value;}
        else if(localResponse.status==='fulfilled'){this.log('statsig real unavailable; using Dots fallback');response=localResponse.value;}
        else throw new Error('Feature flags are unavailable');
      }else if(real&&isAccountCheckRoute(req.method,url.pathname)){
        const upstream=await toReal();
        if(upstream.ok){sendJson(upstream,enableDotsAccount(await upstream.json()));return;}
        this.log('account check real status '+upstream.status);response=upstream;
      }else if(real&&isLocalFirstRoute(url.pathname)){
        const local=await toDots().catch(()=>undefined);
        if(local&&local.ok)response=local;else{if(local)await local.arrayBuffer().catch(()=>undefined);response=await toReal();}
      }else if(real){
        response=await toReal();
        if(response.status>=500||response.status===401||response.status===403)this.log('real '+req.method+' '+url.pathname+' status '+response.status+(response.headers.get('cf-mitigated')?' (Cloudflare challenge)':''));
      }else response=await toDots();
      if(real&&response.ok&&url.pathname==='/backend-api/settings/voices'&&appAuthorization){
        const allowed=['chatgpt-account-id','oai-did','oai-language','originator','sec-ch-ua','sec-ch-ua-mobile','sec-ch-ua-platform','user-agent','x-oai-mcp-form-version','x-openai-codex-window-type','x-openai-web-frontend','sec-fetch-site','sec-fetch-mode','sec-fetch-dest','accept-language'];
        const context=Object.fromEntries(allowed.filter(k=>typeof req.headers[k]==='string').map(k=>[k,req.headers[k]]));
        await writeFile(join(this.options.dataDir,'codex-speech-headers.json'),JSON.stringify(context),{mode:0o600}).catch(()=>{});
      }
      const responseHeaders=headersOf(response);
      if(url.pathname.includes('/files/download/')&&response.ok){try{const body=localDownload(await response.clone().json());res.writeHead(response.status,responseHeaders);res.end(JSON.stringify(body));return;}catch{}}
      if(!real){
        if(url.pathname==='/celsius/ws/user'||url.pathname==='/backend-api/celsius/ws/user'){const body=await response.json();if(response.ok&&typeof body.websocket_url==='string'){const socketUrl=new URL(body.websocket_url);body.websocket_url=`wss://localhost:${port}${socketUrl.pathname}${socketUrl.search}`;}res.writeHead(response.status,responseHeaders);res.end(JSON.stringify(body));return;}
        if(this.options.identityHome&&response.ok&&nativeIdentityRoute(url.pathname)){const identity=await readNativeIdentity(this.options.identityHome);if(identity){res.writeHead(response.status,responseHeaders);res.end(JSON.stringify(projectNativeIdentity(await response.json(),identity)));return;}}
      }
      if(this.options.trace&&/settings\/(user|voices)/.test(url.pathname)){try{this.log('RESP '+url.pathname+' '+(await response.clone().text()).slice(0,900));}catch{}}res.writeHead(response.status,responseHeaders);if(response.body){for await(const chunk of response.body as any){if(!res.write(Buffer.from(chunk)))await new Promise<void>(r=>res.once('drain',r));}}res.end();
    }catch(error){if(!res.headersSent)res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:'Server gateway unavailable',detail:(error as Error).message}));}});
    this.server.on('upgrade',(req,socket,head)=>{
      // Yalnızca Codex RPC ve pubsub kanalları taşınır. Model yanıtı için gelen WebSocket denemeleri (/codex/responses) reddedilir; Codex bunu "desteklenmiyor" sayıp HTTP akışına geçer. Aksi halde cevap hiç gelmez ve arayüz "Thinking"de kalır.
      const connectionServer=this.options.server,connectionState=this.state!,path=new URL(req.url||'/',connectionServer).pathname;
      if(!path.startsWith('/native/app-server')&&!path.includes('celsius/ws')){socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');return;}
      this.wsServer.handleUpgrade(req,socket,head,ws=>{void (async()=>{const p=new URL(req.url||'/',connectionServer),target=new URL(p.pathname.includes('celsius/ws')?'/native/pubsub':'/native/app-server',connectionServer);target.protocol=target.protocol==='https:'?'wss:':'ws:';target.search=p.search;
      const upstream=new WebSocket(target,{headers:{authorization:'Bearer '+await this.snapshotAccess(connectionState,connectionServer)}}),pending:{data:Buffer;binary:boolean}[]=[];ws.on('message',(data,binary)=>{if(upstream.readyState===WebSocket.OPEN)upstream.send(data,{binary});else if(pending.length<100)pending.push({data:Buffer.from(data as Buffer),binary});else ws.close(1008,'Request queue full');});upstream.on('open',()=>{for(const b of pending)upstream.send(b.data,{binary:b.binary});pending.length=0;});upstream.on('message',(data,binary)=>{if(ws.readyState===WebSocket.OPEN)ws.send(data,{binary});});upstream.on('error',()=>ws.close(1011,'Server unavailable'));upstream.on('close',()=>ws.close());ws.on('close',()=>upstream.close());})().catch(()=>ws.close(1011,'Client authentication failed'));});});
    await new Promise<void>((resolve,reject)=>{this.server!.once('error',reject);this.server!.listen(port,'127.0.0.1',()=>resolve());});return {port,certificate:tls.path,codexHome:(this.options.codexHome??join(this.options.dataDir,'codex-home'))};
  }
  private log(message:string){if(!this.options.logFile)return;void appendFile(this.options.logFile,new Date().toISOString()+' '+message+'\n').catch(()=>{});}
  async close(){for(const c of this.wsServer.clients)c.close();await new Promise<void>(resolve=>this.server?this.server.close(()=>resolve()):resolve());this.wsServer.close();}
}
