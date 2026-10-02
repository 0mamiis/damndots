import {cookies} from 'next/headers';
import {SESSION_COOKIE,SERVER_COOKIE} from './session';
export const CONTROLLER_COOKIE='damndots_controller';
export function controllerOrigin(){const u=new URL(process.env.DOTS_CONTROL_URL||'http://127.0.0.1:9340');if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||!['http:','https:'].includes(u.protocol)||u.pathname!=='/'||u.search||u.hash)throw Error('Yerel kontrol adresi loopback olmalı.');return u.origin;}
export async function controllerToken(){const jar=await cookies();return jar.get(CONTROLLER_COOKIE)?.value||jar.get(SESSION_COOKIE)?.value;}
export async function registeredHost(origin:string){const token=await controllerToken();if(!token)return false;const r=await fetch(controllerOrigin()+'/api/v1/connections',{headers:{authorization:'Bearer '+token},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(3000)});if(!r.ok)return false;const state=await r.json();return Array.isArray(state.items)&&state.items.some((p:any)=>p.serverUrl===origin);}
