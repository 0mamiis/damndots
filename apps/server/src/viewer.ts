import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {NativeContext} from './native.js';
import {dotBrowserSession} from './browser-session.js';
import {browserViewerPage} from './browser-viewer-page.js';

export function registerBrowserViewer(app:FastifyInstance,ctx:NativeContext){
  app.get('/tbo/:id/computer/viewer',async(req,reply)=>{
    const id=(req.params as any).id,dot=ctx.runtime.getDot(id);
    const computer=dot.computerId?ctx.workers.get(dot.computerId):ctx.workers.list().find(c=>c.state==='online'&&c.capabilities.includes('browser'));
    if(!computer||computer.state!=='online'||!computer.capabilities.includes('browser'))throw Object.assign(new Error('Connect an online browser computer first'),{statusCode:409});
    const session=dotBrowserSession(ctx.store,id,computer.id);
    const token=ctx.auth.issue('viewer',(req as any).nativeClientId,1800,{dotId:id,computerId:computer.id,sessionId:session.sessionId});
    const nonce=crypto.randomUUID().replaceAll('-','');
    reply.type('text/html').header('cache-control','no-store').header('content-security-policy',`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; form-action 'none'; frame-ancestors app: 'self';`);
    return browserViewerPage({token,dotId:id,computerId:computer.id,name:computer.name,sessionId:session.sessionId},nonce);
  });
  const grant=(req:any)=>{
    const c=ctx.auth.verify(req.body?.token||req.query.t,['viewer']);
    if(!c||c.dotId!==req.params.id)throw Object.assign(new Error('Viewer grant expired or belongs to another dot'),{statusCode:401});
    ctx.workers.get(String(c.computerId));
    dotBrowserSession(ctx.store,String(c.dotId),String(c.computerId),String(c.sessionId));
    return c;
  };
  app.post('/tbo/:id/computer/viewer/control',async req=>{
    const c=grant(req),body=z.object({action:z.enum(['open','navigate','click','type','press','screenshot','takeover','release','close']),sessionId:z.string().nullable().optional(),url:z.string().optional(),x:z.number().optional(),y:z.number().optional(),text:z.string().optional(),key:z.string().optional()}).parse(req.body);
    if(body.sessionId&&body.sessionId!==c.sessionId)throw Object.assign(new Error('Browser session is outside viewer scope'),{statusCode:403});
    return ctx.workers.queue(String(c.computerId),'browser',{...body,sessionId:c.sessionId,dotId:c.dotId,actor:'user',viewerGrantId:c.jti});
  });
  app.get('/tbo/:id/computer/viewer/jobs/:jobId',async req=>{
    const c=grant(req),j=ctx.workers.getJob((req.params as any).jobId);
    if(j.computerId!==c.computerId||j.kind!=='browser'||j.payload?.viewerGrantId!==c.jti)throw Object.assign(new Error('Job is outside viewer scope'),{statusCode:403});
    return {id:j.id,status:j.status,result:j.result,error:j.error};
  });
  app.get('/tbo/:id/computer/viewer/screenshots/:fileId',async(req,reply)=>{
    const c=grant(req),id=(req.params as any).fileId;
    const matching=ctx.store.list<any>('worker_jobs').some(j=>j.computerId===c.computerId&&j.kind==='browser'&&j.payload?.viewerGrantId===c.jti&&j.result?.screenshotId===id);
    if(!matching)throw Object.assign(new Error('Screenshot is outside viewer scope'),{statusCode:403});
    return reply.type('image/png').header('cache-control','no-store').send(await ctx.blobs.read(id));
  });
}
