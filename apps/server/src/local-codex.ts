import {existsSync,readFileSync} from 'node:fs';
import type {ToolDefinition} from '@dots/contracts';
import type {CodexSender} from './codex-sender.js';
const str={type:'string'},num={type:'number'};
const schema=(properties:Record<string,unknown>,required:string[]=[])=>({type:'object',properties,required,additionalProperties:false});
const tools:ToolDefinition[]=[
 {name:'local_codex_projects_list',description:'List projects on the owner’s LOCAL PC. Requires the PC and its Codex app to be on. For work that must continue with the PC off, use codex_projects_list on the VPS instead.',inputSchema:schema({})},
 {name:'local_codex_threads_list',description:'List actual chats in the owner’s LOCAL Codex desktop app. Requires the PC and Codex app to be on.',inputSchema:schema({limit:num})},
 {name:'local_codex_thread_read',description:'Read recent messages and status of an existing chat on the owner’s LOCAL PC.',inputSchema:schema({threadId:str,turns:num},['threadId'])},
 {name:'local_codex_thread_start',description:'Create a chat in an existing project on the owner’s LOCAL PC, using the official Codex app tool. Only when the user requested a new chat. Get projectId using local_codex_projects_list first. This LOCAL work stops if the PC turns off; use codex_thread_start for VPS work.',inputSchema:schema({projectId:str,message:str,name:str},['projectId','message'])},
 {name:'local_codex_thread_send',description:'Send the user-authorized follow-up to an existing LOCAL Codex chat. Requires the PC to be on.',inputSchema:schema({threadId:str,message:str},['threadId','message'])},
 {name:'local_codex_thread_wait',description:'Check or wait up to 60 seconds for a LOCAL Codex chat to finish.',inputSchema:schema({threadId:str,waitSeconds:num},['threadId'])},
];
export const LOCAL_CODEX_TOOL_NAMES=new Set(tools.map(t=>t.name));
export class LocalCodex {
 private tokenFile=process.env.DOTS_LOCAL_CODEX_TOKEN_FILE||'C:\\ProgramData\\DotsCodexBridge\\local-token.txt';
 private url=process.env.DOTS_LOCAL_CODEX_URL||'http://127.0.0.1:9914';
 definitions(){return process.env.DOTS_LOCAL_CODEX_DISABLE!=='1'&&existsSync(this.tokenFile)?tools:[];}
 private async request(tool:string,args:Record<string,unknown>,signal?:AbortSignal,sender?:CodexSender):Promise<any>{
  let response:Response;
  try{response=await fetch(this.url+'/call',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+readFileSync(this.tokenFile,'utf8').trim()},body:JSON.stringify({tool,arguments:args,...sender?{sender}:{}}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(75000)]):AbortSignal.timeout(75000)});}
  catch{throw new Error('Yerel PC veya Codex kapalı/bağlantısız. VPS sohbetleri için codex_* araçlarını kullan.');}
  const result:any=await response.json();
  if(!response.ok)throw new Error(result.error||'Yerel Codex bağlantısı başarısız');
  const text=(result.contentItems||[]).filter((i:any)=>i.type==='inputText').map((i:any)=>i.text).join('\n');
  if(result.success===false)throw new Error(text.slice(0,600)||'Yerel Codex işlemi başarısız');
  try{return JSON.parse(text);}catch{return {text};}
 }
 async call(name:string,args:Record<string,any>,signal?:AbortSignal,sender?:CodexSender):Promise<unknown>{
  switch(name){
   case'local_codex_projects_list':{const r=await this.request('list_projects',{},signal,sender);return {projects:(r.projects||[]).filter((p:any)=>p.hostId==='local')};}
   case'local_codex_threads_list':{const r=await this.request('list_threads',{limit:Math.min(30,Math.max(1,Number(args.limit)||15))},signal,sender);return {...r,pinnedThreads:(r.pinnedThreads||[]).filter((t:any)=>t.hostId==='local'),threads:(r.threads||[]).filter((t:any)=>t.hostId==='local')};}
   case'local_codex_thread_read':return this.request('read_thread',{threadId:args.threadId,hostId:'local',turnLimit:Math.min(5,Math.max(1,Number(args.turns)||2)),maxOutputCharsPerItem:2000},signal,sender);
   case'local_codex_thread_start':return this.request('create_thread',{prompt:args.message,...args.name?{title:args.name}:{},target:{type:'project',projectId:args.projectId,environment:{type:'local'}}},signal,sender);
   case'local_codex_thread_send':return this.request('send_message_to_thread',{threadId:args.threadId,hostId:'local',prompt:args.message},signal,sender);
   case'local_codex_thread_wait':return this.request('wait_threads',{targets:[{threadId:args.threadId,hostId:'local'}],timeoutMs:Math.min(60000,Math.max(0,(Number(args.waitSeconds)||0)*1000))},signal,sender);
   default:throw new Error('Unknown local Codex tool');
  }
 }
}
