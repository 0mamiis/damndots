import {cookies} from 'next/headers';
import {controllerOrigin,controllerToken,CONTROLLER_COOKIE} from '@/lib/controller';
import {SESSION_COOKIE,SERVER_COOKIE,sameOrigin,requestProtocol} from '@/lib/session';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function proxy(request:Request,{params}:{params:Promise<{path?:string[]}>}){
 const path=(await params).path||[];
 if(path.length>2||path.some(p=>! /^[A-Za-z0-9-]+$/.test(p))||['runtime-plan','bootstrap','heartbeat','setup-next'].includes(path[0])||path[0]==='active-session'&&(path.length!==1||request.method!=='GET')||path.length===2&&!['activate','test','computers','enrollment','copy-dot'].includes(path[1]))return Response.json({error:'Invalid control path.'},{status:404});
 if(!sameOrigin(request))return Response.json({error:'Request origin could not be verified.'},{status:403});
 try{
  const token=await controllerToken();if(!token)return Response.json({error:'Sign in to this PC’s dashboard with the local admin key first.'},{status:401});
  const response=await fetch(controllerOrigin()+'/api/v1/connections'+(path.length?'/'+path.map(encodeURIComponent).join('/'):'') ,{method:request.method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer(),cache:'no-store',redirect:'error',signal:AbortSignal.any([request.signal,AbortSignal.timeout(60000)])});
  const data=await response.json();
  if(response.ok&&path[1]==='activate'){
   if(typeof data.session?.accessToken!=='string'||typeof data.profile?.serverUrl!=='string')throw Error('The connection did not return a valid session.');
   const jar=await cookies(),options={httpOnly:true,sameSite:'strict' as const,secure:requestProtocol(request)==='https',path:'/',expires:new Date(data.session.expiresAt)};
   jar.set(CONTROLLER_COOKIE,token,{...options,expires:new Date(Date.now()+86400000)});jar.set(SESSION_COOKIE,data.session.accessToken,options);jar.set(SERVER_COOKIE,data.profile.serverUrl,options);
   return Response.json({profile:data.profile,revision:data.revision},{headers:{'cache-control':'no-store'}});
  }
  if(response.ok&&path[0]==='active-session'){
   if(typeof data.session?.accessToken!=='string'||typeof data.profile?.serverUrl!=='string')throw Error('The active host did not return a valid session.');
   const jar=await cookies(),changed=jar.get(SERVER_COOKIE)?.value!==data.profile.serverUrl;
   if(changed){const options={httpOnly:true,sameSite:'strict' as const,secure:requestProtocol(request)==='https',path:'/',expires:new Date(data.session.expiresAt)};jar.set(CONTROLLER_COOKIE,token,{...options,expires:new Date(Date.now()+86400000)});jar.set(SESSION_COOKIE,data.session.accessToken,options);jar.set(SERVER_COOKIE,data.profile.serverUrl,options);}
   return Response.json({changed,name:data.profile.name},{headers:{'cache-control':'no-store'}});
  }
  return Response.json(data,{status:response.status,headers:{'cache-control':'no-store'}});
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Could not reach local connection management.'},{status:502});}
}
export {proxy as GET,proxy as POST,proxy as PATCH,proxy as DELETE};
