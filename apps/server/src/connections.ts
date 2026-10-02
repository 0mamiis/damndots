import {randomUUID} from 'node:crypto';
import type {RecordStore} from '@dots/contracts';
import {SecretVault} from './integrations/security.js';

export interface HostOptions {nativeEnabled:boolean;workerEnabled:boolean;linuxEnabled:boolean;gatewayPort:number;workerRoots:string[];computerMode?:'pc'|'linux';}
interface HostProfile {id:string;name:string;serverUrl:string;local:boolean;encrypted:string;verifiedAt:string|null;lastError:string|null;createdAt:string;updatedAt:string;}
export interface HostPlan {id:string;revision:string;serverUrl:string;options:HostOptions;client?:any;windows?:any;linux?:any;}
export function hostOrigin(value:string){
 const u=new URL(value);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!['http:','https:'].includes(u.protocol)||u.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw Object.assign(Error('Host adresi yalnız origin olmalı; uzak bağlantılar HTTPS gerektirir.'),{statusCode:400});return u.origin;
}
const emptyOptions:HostOptions={nativeEnabled:true,workerEnabled:true,linuxEnabled:false,gatewayPort:8000,workerRoots:[],computerMode:'pc'};
/** Local control-plane only. Remote credentials never enter list/status responses. */
export class HostConnections {
 private mutations:Promise<unknown>=Promise.resolve();
 constructor(private store:RecordStore,private vault:SecretVault,private local:{url:string;adminKey:string},private fetcher:typeof fetch=fetch){
  if(!store.get('host_profiles','local'))this.save({id:'local',name:'Bu bilgisayar',serverUrl:hostOrigin(local.url),local:true,encrypted:vault.seal({adminKey:local.adminKey,options:emptyOptions}),verifiedAt:null,lastError:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  if(!store.get('host_active','owner'))store.put('host_active',{id:'owner',profileId:'local',revision:randomUUID()});
 }
 private profile(id:string){const p=this.store.get<HostProfile>('host_profiles',id);if(!p)throw Object.assign(Error('Host bulunamadı.'),{statusCode:404});return p;}
 private private(p:HostProfile){return this.vault.open(p.encrypted);}
 private save(p:HostProfile){return this.store.put('host_profiles',p);}
 private view(p:HostProfile){const c=this.private(p);return {id:p.id,name:p.name,serverUrl:p.serverUrl,local:p.local,hasKey:!!c.adminKey,options:{...emptyOptions,...c.options},verifiedAt:p.verifiedAt,lastError:p.lastError};}
 list(){return this.store.list<HostProfile>('host_profiles').map(p=>this.view(p));}
 status(){const active=this.store.get<any>('host_active','owner')!;const controller=this.store.get<any>('host_controller','owner');return {items:this.list(),activeId:active.profileId,activeOptions:this.plan().options,revision:active.revision,controller:controller&&Date.now()-Date.parse(controller.updatedAt)<15000?controller:null};}
 create(input:{name:string;serverUrl:string;adminKey:string}){const url=hostOrigin(input.serverUrl);if(!input.name.trim()||!input.adminKey.trim())throw Object.assign(Error('Host adı ve yönetici anahtarı gerekli.'),{statusCode:400});if(this.list().some(p=>p.serverUrl===url))throw Object.assign(Error('Bu host zaten kayıtlı.'),{statusCode:409});const now=new Date().toISOString();return this.view(this.save({id:randomUUID(),name:input.name.trim(),serverUrl:url,local:false,encrypted:this.vault.seal({adminKey:input.adminKey,options:emptyOptions}),verifiedAt:null,lastError:null,createdAt:now,updatedAt:now}));}
 update(id:string,input:{name?:string;adminKey?:string;options?:Partial<HostOptions>}){
  const p=this.profile(id),c=this.private(p);const options={...emptyOptions,...c.options,...input.options};
  if(input.options?.computerMode){options.computerMode=input.options.computerMode;options.workerEnabled=options.computerMode==='pc';options.linuxEnabled=options.computerMode==='linux';}
  if(!Number.isInteger(options.gatewayPort)||options.gatewayPort<1024||options.gatewayPort>65535)throw Object.assign(Error('Gateway portu 1024–65535 arasında olmalı.'),{statusCode:400});
  if(!options.workerRoots.every((r:string)=>typeof r==='string'&&(/^[A-Za-z]:[\\/]/.test(r)||r.startsWith('/'))&&!r.includes('\0')))throw Object.assign(Error('Worker dizinleri mutlak yol olmalı.'),{statusCode:400});
  if(p.local&&input.adminKey)throw Object.assign(Error('Yerel anahtar bu ekrandan değiştirilmez.'),{statusCode:400});
  this.save({...p,name:input.name?.trim()||p.name,encrypted:this.vault.seal({...c,adminKey:input.adminKey||c.adminKey,options}),updatedAt:new Date().toISOString()});return this.view(this.profile(id));
 }
 remove(id:string){if(id==='local'||this.status().activeId===id)throw Object.assign(Error('Yerel veya aktif host silinemez.'),{statusCode:409});this.store.delete('host_profiles',id);return {deleted:true};}
 private async request(p:HostProfile,path:string,token?:string,body?:unknown,method?:string){
  const response=await this.fetcher(p.serverUrl+path,{method:method||(body===undefined?'GET':'POST'),headers:{...token?{authorization:'Bearer '+token}:{},...body===undefined?{}:{'content-type':'application/json'}},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok)throw Object.assign(Error('Host bağlantısı reddedildi ('+response.status+'). Adresi ve anahtarı kontrol edin.'),{statusCode:502});try{return await response.json();}catch{throw Object.assign(Error('Host geçerli JSON döndürmedi.'),{statusCode:502});}
 }
 private async login(p:HostProfile){const s=await this.request(p,'/api/v1/session',undefined,{token:this.private(p).adminKey});if(typeof s.accessToken!=='string'||!Number.isFinite(Date.parse(s.expiresAt)))throw Object.assign(Error('Host geçerli oturum döndürmedi.'),{statusCode:502});return s;}
 async test(id:string){const p=this.profile(id);try{const health=await this.request(p,'/health');if(health.ok!==true||health.connectionProtocol!==1)throw Error('Host damndots bağlantı protokolünü desteklemiyor. Sunucuyu v0.1 ile güncelleyin.');await this.login(p);this.save({...p,verifiedAt:new Date().toISOString(),lastError:null});return {ok:true,version:health.version,serverUrl:p.serverUrl};}catch(error){const message=(error as Error).message;this.save({...p,lastError:message});throw error;}}
 bootstrap(input:{options:HostOptions;client?:any;windows?:any;linux?:any}){
  const p=this.profile('local'),c=this.private(p);if(c.bootstrapped)return;
  this.save({...p,encrypted:this.vault.seal({...c,...input,bootstrapped:true})});
  const active=this.store.get<any>('host_active','owner');if(active?.profileId==='local'&&!active.encryptedPlan)this.store.put('host_active',{...active,encryptedPlan:this.vault.seal({serverUrl:p.serverUrl,...input})});
 }
 heartbeat(input:{profileId:string;revision:string;nativeReady:boolean;workerReady:boolean;linuxReady:boolean;error:string|null}){this.store.put('host_controller',{id:'owner',...input,updatedAt:new Date().toISOString()});return {ok:true};}
 async activate(id:string){
  const operation=this.mutations.then(async()=>{
   await this.test(id);const p=this.profile(id),s=await this.login(p),c=this.private(p),options:HostOptions={...emptyOptions,...c.options};
   if((options.workerEnabled||options.linuxEnabled)&&!options.workerRoots.length&&options.workerEnabled)throw Object.assign(Error('Windows worker için en az bir çalışma dizini seçin.'),{statusCode:400});
   const current=this.profile(this.status().activeId);try{const currentSession=await this.login(current),overview=await this.request(current,'/api/v1/overview',currentSession.accessToken);if(overview.tasks?.some((t:any)=>['running','waiting_approval'].includes(t.status)))throw Object.assign(Error('Host değişmeden önce çalışan görevleri bitirin veya Görevler bölümünden iptal edin.'),{statusCode:409});}catch(error){if((error as any).statusCode===409)throw error;}
   if(options.nativeEnabled&&!c.client){const e=await this.request(p,'/api/v1/clients/enrollment',s.accessToken,{});c.client={...await this.request(p,'/client/enroll',undefined,{token:e.token}),server:p.serverUrl};}
   for(const kind of ['windows','linux'] as const){const enabled=kind==='windows'?options.workerEnabled:options.linuxEnabled;if(!enabled)continue;const roots=kind==='windows'?options.workerRoots:['/home/dot/Workspace'];
    if(!c[kind]){const e=await this.request(p,'/api/v1/computers/enrollment',s.accessToken,{});c[kind]={...await this.request(p,'/worker/register',undefined,{token:e.token,name:kind==='windows'?'Windows computer':'Dot Linux computer',platform:kind==='windows'?'win32':'linux',roots,capabilities:['codex','browser','filesystem',...kind==='linux'?['desktop']:[]]}),server:p.serverUrl};}
    else await this.request(p,'/api/v1/computers/'+c[kind].computerId,s.accessToken,{roots},'PATCH');
   }
   const selected=options.computerMode==='linux'?c.linux:c.windows;if(selected){await this.request(p,'/api/v1/settings',s.accessToken,{defaultComputerId:selected.computerId},'PATCH');const all=await this.request(p,'/api/v1/dots',s.accessToken);for(const dot of all.items||[])if(!dot.computerId||[c.windows?.computerId,c.linux?.computerId].includes(dot.computerId))await this.request(p,'/api/v1/dots/'+dot.id,s.accessToken,{computerId:selected.computerId},'PATCH');}
   this.save({...p,encrypted:this.vault.seal(c),lastError:null});const revision=randomUUID();this.store.put('host_active',{id:'owner',profileId:id,revision,encryptedPlan:this.vault.seal({serverUrl:p.serverUrl,options,client:c.client,windows:c.windows,linux:c.linux})});return {profile:this.view(this.profile(id)),revision,session:s};
  });this.mutations=operation.catch(()=>{});return operation;
 }
 plan():HostPlan{const active=this.store.get<any>('host_active','owner')!,p=this.profile(active.profileId),c=active.encryptedPlan?this.vault.open(active.encryptedPlan):this.private(p);return {id:p.id,revision:active.revision,serverUrl:c.serverUrl||p.serverUrl,options:{...emptyOptions,...c.options},client:c.client,windows:c.windows,linux:c.linux};}
}
