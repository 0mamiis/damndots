import {createServer,type Server} from 'node:http';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
/** Only worker routes cross this loopback relay. The selected host still authenticates every worker token. */
export class WorkerRelay {
 private server?:Server;
 constructor(private target:string,private port=9352){}
 setTarget(value:string){const u=new URL(value);if(u.username||u.password||!['http:','https:'].includes(u.protocol)||u.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw Error('Worker relay target requires HTTPS or loopback HTTP.');this.target=u.origin;}
 async start(){this.setTarget(this.target);this.server=createServer((req,res)=>{void(async()=>{
  const u=new URL(req.url||'/','http://localhost');if(u.pathname!=='/health'&&!u.pathname.startsWith('/worker/')){res.writeHead(404).end();return;}
  const target=this.target,headers=new Headers();for(const [key,value] of Object.entries(req.headers))if(value&&!['host','connection','content-length','transfer-encoding','cookie','proxy-authorization'].includes(key))headers.set(key,Array.isArray(value)?value.join(','):value);
  const response=await fetch(target+u.pathname+u.search,{method:req.method,headers,...['GET','HEAD'].includes(req.method||'GET')?{}:{body:Readable.toWeb(req) as any,duplex:'half' as any},redirect:'error',signal:AbortSignal.timeout(30*60*1000)} as any);
  const output:Record<string,string>={};for(const [k,v] of response.headers)if(!['connection','transfer-encoding','content-encoding','content-length'].includes(k))output[k]=v;
  res.writeHead(response.status,output);if(response.body)await pipeline(Readable.fromWeb(response.body as any),res);else res.end();
 })().catch(()=>{if(!res.headersSent)res.writeHead(502);res.end('Worker host unavailable');});});await new Promise<void>((r,j)=>{this.server!.once('error',j);this.server!.listen(this.port,'127.0.0.1',r);});return (this.server.address() as any).port;}
 async close(){this.server?.closeAllConnections();await new Promise<void>(r=>this.server?this.server.close(()=>r()):r());}
}
