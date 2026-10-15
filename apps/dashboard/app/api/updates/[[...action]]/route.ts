import {controllerOrigin,controllerToken} from '@/lib/controller';
import {sameOrigin} from '@/lib/session';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function proxy(request:Request,{params}:{params:Promise<{action?:string[]}>}){
  const action=(await params).action||[];
  if(action.length>1||action.length===1&&!['apply','notice'].includes(action[0]))return Response.json({error:'Invalid update action'},{status:404});
  if(request.method==='POST'&&!sameOrigin(request))return Response.json({error:'Request origin could not be verified'},{status:403});
  if((request.method==='GET'&&action.length)||(request.method==='POST'&&!action.length))return Response.json({error:'Invalid update method'},{status:405});
  try{
    const token=await controllerToken();if(!token)return Response.json({error:'Sign in with the local admin key to manage this installation.'},{status:401});
    const query=request.method==='GET'&&new URL(request.url).searchParams.get('refresh')==='1'?'?refresh=1':'';
    const r=await fetch(controllerOrigin()+'/api/v1/updates'+(action.length?'/'+action[0]:'')+query,{method:request.method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:request.method==='POST'?await request.text():undefined,cache:'no-store',redirect:'error',signal:AbortSignal.any([request.signal,AbortSignal.timeout(20000)])});
    return Response.json(await r.json(),{status:r.status,headers:{'cache-control':'no-store'}});
  }catch{return Response.json({error:'The local updater is not reachable. It may be restarting.'},{status:502});}
}
export {proxy as GET,proxy as POST};
