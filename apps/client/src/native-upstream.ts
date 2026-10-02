/** Routing rules for the original desktop app: its own account/plugin/settings traffic stays on the real service,
 * while Dot-owned resources go to the Dots backend.
 */
export const UPSTREAM_ORIGIN='https://chatgpt.com';
const DOTS_PREFIXES=['/backend-api/tbo','/backend-api/messaging/','/backend-api/cloud-aeons','/backend-api/celsius/ws/user','/backend-api/wham/realtime/calls'];
export function isDotsRoute(path:string):boolean{
  return DOTS_PREFIXES.some(prefix=>path===prefix||path.startsWith(prefix.endsWith('/')?prefix:prefix+'/')||path.startsWith(prefix+'?'));
}
/** Dot attachments and outputs use local file ids; other files belong to the real account. */
export function isLocalFirstRoute(path:string):boolean{return path.startsWith('/backend-api/files/download/')||path.startsWith('/backend-api/files/content/');}
export const isStatsigRoute=(method:string|undefined,path:string)=>method==='POST'&&path==='/backend-api/wham/statsig/bootstrap';
export const isAccountCheckRoute=(method:string|undefined,path:string)=>method==='GET'&&path.startsWith('/backend-api/accounts/check/');

const object=(value:unknown):Record<string,any>|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:undefined;
/** Keeps the real account's feature flags and adds only the flags Dots needs. Returns undefined when hashes are incompatible. */
export function mergeStatsig(real:unknown,local:unknown):unknown|undefined{
  const realBody=object(real),localBody=object(local);if(!realBody||!localBody)return;
  const encoded=typeof realBody.statsigPayload==='string';
  let realPayload:any,localPayload:any;
  try{realPayload=encoded?JSON.parse(realBody.statsigPayload):realBody;localPayload=typeof localBody.statsigPayload==='string'?JSON.parse(localBody.statsigPayload):localBody;}catch{return;}
  if(!object(realPayload)||!object(localPayload?.feature_gates))return;
  if(realPayload.hash_used!=='djb2'||localPayload.hash_used!=='djb2')return;
  realPayload.feature_gates={...(object(realPayload.feature_gates)||{}),...localPayload.feature_gates};
  return encoded?{...realBody,statsigPayload:JSON.stringify(realPayload)}:realPayload;
}
/** The account list stays real; only the Dots availability and eligibility flags are set, so a real plan that excludes Dots cannot lock the local Dot. */
export function enableDotsAccount(value:unknown):unknown{
  const body=object(value),accounts=object(body?.accounts);if(!body||!accounts)return value;
  const next:Record<string,any>={};
  for(const [id,entry] of Object.entries(accounts)){const item=object(entry),account=object(item?.account);next[id]=item&&account?{...item,account:{...account,tbo_config:{...(object(account.tbo_config)||{}),tbo_available:true,plan_eligible:true}}}:entry;}
  return {...body,accounts:next};
}
