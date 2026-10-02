import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import type { Connector, ToolDefinition } from '@dots/contracts';
import { endpoint, IntegrationError, object, required } from './security.js';

export interface ProviderContext {fetch:typeof fetch; now:()=>number;}
export function scoped(connector:Connector,scope:string):void {
  if(!connector.scopes.includes(scope)) throw new IntegrationError(`Required scope: ${scope}`,403);
}
export async function json(ctx:ProviderContext,url:string,init:RequestInit={}):Promise<Record<string,any>> {
  const response=await ctx.fetch(endpoint(url),{...init,signal:init.signal??AbortSignal.timeout(30_000),redirect:'error'});
  if(!response.ok) throw new IntegrationError(`Provider HTTP ${response.status}`,502);
  try{const data=await response.json();if(!data || typeof data!=='object')throw new Error();return data as Record<string,any>;}catch{throw new IntegrationError('Provider returned invalid JSON',502);}
}
export async function slack(ctx:ProviderContext,c:Record<string,any>,method:string,args:Record<string,any>={}):Promise<Record<string,any>> {
  const response=await json(ctx,`${c.apiUrl??'https://slack.com/api/'}${method}`,{method:'POST',headers:{authorization:`Bearer ${required(c.botToken,'botToken')}`,'content-type':'application/json'},body:JSON.stringify(args)});
  if(response.ok!==true) throw new IntegrationError(`Slack: ${typeof response.error==='string'&&/^[a-z_]+$/.test(response.error)?response.error:'provider_error'}`,502);
  return response;
}
export function githubUrl(c:Record<string,any>,path:string):string {return `${(c.apiUrl??'https://api.github.com').replace(/\/$/,'')}${path}`;}
export async function github(ctx:ProviderContext,c:Record<string,any>,path:string,method='GET',body?:unknown):Promise<Record<string,any>> {
  return json(ctx,githubUrl(c,path),{method,headers:{authorization:`Bearer ${required(c.token,'token')}`,accept:'application/vnd.github+json','x-github-api-version':'2022-11-28','content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
}
export async function teamsToken(ctx:ProviderContext,c:Record<string,any>):Promise<string> {
  const response=await json(ctx,c.tokenUrl??`https://login.microsoftonline.com/${encodeURIComponent(c.tenantId??'botframework.com')}/oauth2/v2.0/token`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:required(c.appId,'appId'),client_secret:required(c.appSecret,'appSecret'),scope:'https://api.botframework.com/.default'}).toString()});
  return required(response.access_token,'provider access_token');
}
export async function validateTeams(ctx:ProviderContext,c:Record<string,any>,authorization:string|undefined,activity:Record<string,any>):Promise<void> {
  if(!authorization?.startsWith('Bearer '))throw new IntegrationError('Bearer token required',401);
  const metadata=await json(ctx,c.openIdUrl??'https://login.botframework.com/v1/.well-known/openidconfiguration');
  // Issuer cannot be changed by a received activity or token.
  if(metadata.issuer!=='https://api.botframework.com')throw new IntegrationError('Invalid Bot Framework issuer',401);
  const jwks=await json(ctx,required(metadata.jwks_uri,'jwks_uri'));
  const token=authorization.slice(7);
  try {
    const header=decodeProtectedHeader(token);
    const {payload}=await jwtVerify(token,createLocalJWKSet(jwks as any),{issuer:'https://api.botframework.com',audience:required(c.appId,'appId'),algorithms:['RS256'],requiredClaims:['exp','nbf','serviceUrl'],currentDate:new Date(ctx.now()),clockTolerance:0});
    if(payload.serviceUrl!==activity.serviceUrl)throw new Error('serviceUrl mismatch');
    const signingKey=(jwks.keys as any[]).find(k=>k.kid===header.kid);
    if(activity.channelId!=='msteams' || !signingKey?.endorsements?.includes('msteams'))throw new Error('Missing Teams endorsement');
    endpoint(activity.serviceUrl);
  }catch{throw new IntegrationError('Invalid Bot Framework token or channel endorsement',401);}
}
export async function withMcp<T>(c:Record<string,any>,fn:(client:Client)=>Promise<T>):Promise<T> {
  const client=new Client({name:'dots-selfhosted',version:'0.1.0'});
  const url=new URL(endpoint(c.url));
  const guardedFetch:typeof fetch=async(input,init)=>{
    const destination=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    if(destination.origin!==url.origin)throw new IntegrationError('MCP requested a different origin',403);
    endpoint(destination.href);return fetch(input,{...init,redirect:'error'});
  };
  const opts={requestInit:{headers:c.headers??{},redirect:'error' as const},fetch:guardedFetch};
  const transport=c.transport==='sse'?new SSEClientTransport(url,opts):new StreamableHTTPClientTransport(url,opts);
  try{await client.connect(transport);return await fn(client);}finally{await client.close();}
}
export async function emailConfig(ctx:ProviderContext,c:Record<string,any>):Promise<Record<string,any>> {
  if(!c.oauth)return c;
  const oauth=object(c.oauth);
  const parameters:Record<string,string>={grant_type:'refresh_token',client_id:required(oauth.clientId,'OAuth clientId'),refresh_token:required(oauth.refreshToken,'OAuth refreshToken')};
  if(oauth.clientSecret)parameters.client_secret=required(oauth.clientSecret,'OAuth clientSecret');
  if(oauth.scope)parameters.scope=required(oauth.scope,'OAuth scope');
  const response=await json(ctx,endpoint(oauth.tokenUrl),{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(parameters).toString()});
  return {...c,accessToken:required(response.access_token,'OAuth provider access_token'),oauth:{...oauth,...(response.refresh_token?{refreshToken:required(response.refresh_token,'OAuth provider refresh_token')}:{})}};
}
export function emailAuth(c:Record<string,any>):Record<string,any> {
  const user=required(c.user,'email user');
  if(c.accessToken)return {user,accessToken:required(c.accessToken,'accessToken')};
  return {user,pass:required(c.password,'email password')};
}
function mailServer(c:Record<string,any>):Record<string,any> {
  const host=required(c.host,'email host'),secure=c.secure!==false;
  if(!secure && !['127.0.0.1','localhost','::1'].includes(host))throw new IntegrationError('Remote mail servers require TLS');
  return {host,port:Number(c.port??(secure?993:143)),secure,auth:emailAuth(c),logger:false,tls:{rejectUnauthorized:true}};
}
export function smtpTransport(c:Record<string,any>) {
  const config=mailServer(c);
  return nodemailer.createTransport({...config,port:Number(c.port??(config.secure?465:587)),requireTLS:!config.secure && !['127.0.0.1','localhost','::1'].includes(config.host),auth:c.accessToken?{type:'OAuth2',user:c.user,accessToken:c.accessToken}:emailAuth(c),connectionTimeout:15_000,greetingTimeout:15_000,socketTimeout:30_000});
}
export async function withImap<T>(c:Record<string,any>,fn:(client:ImapFlow)=>Promise<T>):Promise<T> {
  const client=new ImapFlow({...mailServer(c),connectionTimeout:15_000,socketTimeout:30_000} as any);
  try{await client.connect();return await fn(client);}finally{try{await client.logout();}catch{client.close();}}
}
export async function readMail(c:Record<string,any>,afterUid=0,limit=20,knownValidity?:string):Promise<{uid:number;uidValidity:string;messageId:string;from:string;fromAddresses:string[];subject:string;text:string}[]> {
  return withImap(c,async client=> {
    const lock=await client.getMailboxLock(c.mailbox??'INBOX');
    try {
      const mailbox=client.mailbox;if(!mailbox)return [];
      const validity=String(mailbox.uidValidity);
      if(knownValidity && knownValidity!==validity)afterUid=0;
      const uids=await client.search({uid:`${afterUid+1}:*`},{uid:true});
      if(!uids || !uids.length)return [];
      const result=[];
      for(const uid of uids.filter(uid=>uid>afterUid).slice(0,Math.min(100,limit))) {
        const record=await client.fetchOne(uid,{source:true},{uid:true});if(!record || !record.source)continue;
        const mail=await simpleParser(record.source);
        result.push({uid,uidValidity:validity,messageId:mail.messageId??String(uid),from:mail.from?.text??'',fromAddresses:mail.from?.value.map(v=>v.address?.toLowerCase()??'')??[],subject:mail.subject??'',text:mail.text??''});
      }
      return result;
    }finally{lock.release();}
  });
}
export function definition(name:string,description:string,properties:Record<string,unknown>,requiredFields:string[]=[]):ToolDefinition {
  return {name,description,inputSchema:{type:'object',properties,required:requiredFields,additionalProperties:false}};
}
const str={type:'string'};
export const toolsets:Partial<Record<Connector['kind'],ToolDefinition[]>>={
  slack:[definition('read_messages','Read Slack conversation history',{channel:str,limit:{type:'integer',minimum:1,maximum:100}},['channel']),definition('send_message','Send a Slack message after approval',{channel:str,text:str,thread_ts:str},['channel','text'])],
  teams:[definition('send_message','Send a Bot Framework activity after approval',{conversationId:str,text:str,serviceUrl:str},['conversationId','text'])],
  email:[definition('read_messages','Read messages from configured IMAP mailbox',{afterUid:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}}),definition('send_message','Send email after approval',{to:str,subject:str,text:str},['to','subject','text'])],
  github:[definition('get_repository','Read configured GitHub repository',{}),definition('list_issues','List issues in configured repository',{}),definition('create_issue','Create GitHub issue after approval',{title:str,body:str},['title'])],
  webhook:[definition('send','POST signed JSON to configured webhook after approval',{payload:{type:'object'}},['payload'])],
};
