import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
export interface NativeIdentity{accountId:string;userId:string;accountUserId:string;plan:string;}
/** Project only account/bootstrap metadata onto the real signed-in desktop identity.
 * The local backend continues to use its own local enrollment token.
 */
export async function readNativeIdentity(home:string):Promise<NativeIdentity|undefined>{
 try{
  const auth=JSON.parse(await readFile(join(home,'auth.json'),'utf8'));
  const token=auth.tokens?.access_token;if(typeof token!=='string')return;
  const body=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
  const a=body['https://api.openai.com/auth']||{};
  const accountId=auth.tokens.account_id||a.chatgpt_account_id,userId=a.user_id||a.chatgpt_user_id;
  if(typeof accountId!=='string'||typeof userId!=='string'||accountId==='acct_local_orbit')return;
  return {accountId,userId,accountUserId:a.chatgpt_account_user_id||userId,plan:a.chatgpt_plan_type||'free'};
 }catch{return;}
}
export function nativeIdentityRoute(path:string){
 return path==='/backend-api/me'||path==='/backend-api/wham/accounts/check'||path.startsWith('/backend-api/accounts/check/')||path==='/backend-api/wham/statsig/bootstrap';
}
export function projectNativeIdentity(value:unknown,identity:NativeIdentity,key=''):unknown{
 if(typeof value==='string'){
  if(value==='acct_local_orbit')return identity.accountId;
  if(value==='user_local_orbit')return key==='account_user_id'?identity.accountUserId:identity.userId;
  if((key==='plan_type'||key==='chatgpt_plan_type')&&value==='pro')return identity.plan;
  // statsigPayload is an encoded JSON document, never a model/user message.
  if(key==='statsigPayload'){try{return JSON.stringify(projectNativeIdentity(JSON.parse(value),identity));}catch{}}
  return value;
 }
 if(Array.isArray(value))return value.map(item=>projectNativeIdentity(item,identity,key));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k==='acct_local_orbit'?identity.accountId:k,projectNativeIdentity(v,identity,k)]));
 return value;
}
