import {readFile,writeFile,mkdir,rename,open,unlink} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';

const run=promisify(execFile);
export const RELEASE_API='https://api.github.com/repos/0mamiis/damndots/releases/latest';
export const REPOSITORY='https://github.com/0mamiis/damndots';
export const installationRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
export function versionParts(tag:string):number[]|null {
  const m=/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag);
  return m&&m.slice(1).every(n=>Number.isSafeInteger(Number(n)))?m.slice(1).map(Number):null;
}
export function newerVersion(candidate:string,current:string):boolean {
  const a=versionParts(candidate),b=versionParts(current);if(!a||!b)return false;
  for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;
}
export interface ReleaseInfo {tag:string;version:string;url:string;notes:string;publishedAt:string;}
export function releaseInfo(value:any):ReleaseInfo {
  if(!value||value.draft||value.prerelease||!versionParts(value.tag_name))throw Error('No stable release was found');
  const url=REPOSITORY+'/releases/tag/'+value.tag_name;
  if(value.html_url!==url)throw Error('Unexpected release source');
  return {tag:value.tag_name,version:value.tag_name.replace(/^v/,''),url,notes:typeof value.body==='string'?value.body.slice(0,20000):'',publishedAt:String(value.published_at||'')};
}
export interface UpdateJob {id:string;target:string;status:string;step:string;startedAt:string;updatedAt:string;previous?:string;stackPid:number;finishedAt?:string;}
const active=new Set(['preparing','ready','applying','restarting','rolling_back']);
export class UpdateService {
  private current:string;private cached?:ReleaseInfo;private checkedAt:number=0;private checking?:Promise<void>;private error:string|null=null;private starting=false;
  private failures=0;private retryAt=0;
  private sourceCheck?:{time:number;reason:string|null};
  constructor(private options:{root?:string;dataDir:string;fetch?:typeof fetch;busy:()=>boolean;maintenance:(value:boolean)=>void;stackPid?:number;clock?:()=>number;launch?:(job:UpdateJob)=>Promise<void>}){
    const root=options.root||installationRoot;this.current=JSON.parse(requireText(join(root,'package.json'))).version;
  }
  private root(){return this.options.root||installationRoot;}
  get currentVersion(){return this.current;}
  private now(){return (this.options.clock||Date.now)();}
  private directory(){return join(this.options.dataDir,'updates');}
  private async job():Promise<UpdateJob|null>{
    try{return JSON.parse(await readFile(join(this.directory(),'job.json'),'utf8'));}catch{return null;}
  }
  async check(force=false){
    if(this.checking)return this.checking;
    // Success is cached for an hour. A failed check (for example right after boot, before the network is up) retries soon with a growing delay.
    const wait=force?this.checkedAt+60000:this.error?this.retryAt:this.checkedAt+60*60*1000;
    if(this.checkedAt&&this.now()<wait)return;
    this.checking=(async()=>{
      this.checkedAt=this.now();
      try{
        const r=await (this.options.fetch||fetch)(RELEASE_API,{headers:{accept:'application/vnd.github+json','user-agent':'damndots-updater'},redirect:'error',signal:AbortSignal.timeout(10000)});
        if(!r.ok)throw Error(r.status===403||r.status===429?'GitHub rate limit reached. The next check will retry.':'GitHub release check failed ('+r.status+')');
        this.cached=releaseInfo(await r.json());this.error=null;this.failures=0;
      }catch(e){this.error=e instanceof Error?e.message:'Could not check releases';this.retryAt=this.now()+Math.min(15*60000,30000*2**this.failures++);}
    })().finally(()=>{this.checking=undefined;});
    return this.checking;
  }
  async status(force=false){
    await this.check(force);
    const job=await this.job();
    let blocked:string|null=null;
    const pid=this.options.stackPid??Number(process.env.DOTS_MANAGED_STACK_PID);
    if(!Number.isSafeInteger(pid)||pid<1||(!this.options.launch&&process.env.DOTS_UPDATE_MANAGED!=='1'))blocked='Restart all Dots services together with Start-Dots to enable managed updates.';
    else if(!existsSync(join(this.root(),'.git')))blocked='This is a source archive installation. Use a Git checkout for in-app updates.';
    else if(this.cached&&newerVersion(this.cached.version,this.current)){
      // These checks only matter once there is something to install.
      if(this.options.busy())blocked='Finish or cancel active tasks before updating.';
      else {
      if(!this.sourceCheck||this.now()-this.sourceCheck.time>60000){
        let reason:string|null=null;
        try{
          const changes=(await run('git',['status','--porcelain'],{cwd:this.root(),windowsHide:true})).stdout.trim();
          if(changes)reason='Local source changes detected. Back up or commit them before updating; they will not be overwritten.';
        }catch{reason='Git is not available for this installation.';}
        this.sourceCheck={time:this.now(),reason};
      }
      blocked=this.sourceCheck.reason;
      }
    }
    return {current:this.current,latest:this.cached||null,available:!!this.cached&&newerVersion(this.cached.version,this.current),checkedAt:this.checkedAt?new Date(this.checkedAt).toISOString():null,error:this.error,blocked,job};
  }
  async start(tag:string){
    if(this.starting)throw Object.assign(Error('An update is already starting'),{statusCode:409});
    this.starting=true;
    try{
      const state=await this.status(true);
      if(state.blocked)throw Object.assign(Error(state.blocked),{statusCode:409});
      if(state.error||!state.available||tag!==state.latest?.tag)throw Object.assign(Error('Check releases again before updating'),{statusCode:409});
      if(state.job&&active.has(state.job.status))throw Object.assign(Error('An update is already running'),{statusCode:409});
      // No request parameter can choose an executable, repository, branch or installation path.
      const origin=(await run('git',['remote','get-url','origin'],{cwd:this.root(),windowsHide:true})).stdout.trim().replace(/\.git$/,'');
      if(![REPOSITORY,'git@github.com:0mamiis/damndots'].includes(origin))throw Object.assign(Error('The Git origin is not the official damndots repository'),{statusCode:409});
      const dirty=(await run('git',['status','--porcelain','--untracked-files=no'],{cwd:this.root(),windowsHide:true})).stdout.trim();
      if(dirty)throw Object.assign(Error('Local source changes detected. Commit or back them up before updating; they will not be overwritten.'),{statusCode:409});
      const untracked=(await run('git',['ls-files','--others','--exclude-standard'],{cwd:this.root(),windowsHide:true})).stdout.trim();
      if(untracked)throw Object.assign(Error('Untracked source files detected. Move or back them up before updating.'),{statusCode:409});
      await mkdir(this.directory(),{recursive:true});
      const lock=join(this.directory(),'update.lock');
      let handle;try{handle=await open(lock,'wx',0o600);}catch{throw Object.assign(Error('Another updater holds the installation lock. Check its status before trying again.'),{statusCode:409});}
      const job:UpdateJob={id:randomUUID(),target:tag,status:'preparing',step:'Preparing update',startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),stackPid:this.options.stackPid??Number(process.env.DOTS_MANAGED_STACK_PID)};
      try {
        await handle.writeFile(job.id);await handle.close();
        await atomicJson(join(this.directory(),'job.json'),job);
        if(this.options.busy())throw Object.assign(Error('A task started during the update check. Finish it before updating.'),{statusCode:409});
        this.options.maintenance(true);
        if(this.options.launch)await this.options.launch(job);
        else {
          // Through a short-lived launcher so the updater is not in this server's process tree: stopping the services must not stop it.
          await new Promise<void>((ok,no)=>{
            const launcher=spawn(process.execPath,[join(this.root(),'scripts/detach.mjs'),join(this.directory(),'update.log'),this.root(),process.execPath,join(this.root(),'scripts/update.mjs'),'--job',join(this.directory(),'job.json')],{cwd:this.root(),env:{...process.env,DOTS_UPDATE_DATA:this.options.dataDir},stdio:'ignore',windowsHide:true});
            launcher.once('error',no);launcher.once('exit',code=>code===0?ok():no(Error('The updater could not be started')));
          });
        }
        return job;
      }catch(e){
        this.options.maintenance(false);await unlink(lock).catch(()=>{});
        await atomicJson(join(this.directory(),'job.json'),{...job,status:'failed',step:'Could not start the updater',updatedAt:new Date().toISOString()});
        throw e;
      }
    }finally{this.starting=false;}
  }
  async syncMaintenance(){
    let job=await this.job();
    if(job&&active.has(job.status)&&Date.now()-Date.parse(job.startedAt)>120000){
      let alive=false;
      try{
        const owner=JSON.parse(await readFile(join(this.directory(),'updater.json'),'utf8'));
        if(owner.id===job.id&&Number.isSafeInteger(owner.pid)&&owner.pid>0){
          try{process.kill(owner.pid,0);alive=true;}catch(e){alive=(e as NodeJS.ErrnoException).code==='EPERM';}
        }
      }catch{}
      if(!alive){
        job={...job,status:'failed',step:'The updater stopped unexpectedly. Your data is preserved. Check the local update log before retrying.',updatedAt:new Date().toISOString()};
        await atomicJson(join(this.directory(),'job.json'),job);
        if((await readFile(join(this.directory(),'update.lock'),'utf8').catch(()=>''))===job.id)await unlink(join(this.directory(),'update.lock')).catch(()=>{});
      }
    }
    this.options.maintenance(!!job&&active.has(job.status));
  }
}
function requireText(path:string){return readFileSync(path,'utf8');}
/** Windows can refuse a rename for a moment while a scanner or reader holds the target. */
export async function atomicJson(path:string,value:unknown){
  const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  for(let attempt=0;;attempt++){
    try{await rename(temp,path);return;}
    catch(error){if(!['EPERM','EBUSY','EACCES'].includes((error as NodeJS.ErrnoException).code||'')||attempt>=10){await unlink(temp).catch(()=>{});throw error;}await new Promise(r=>setTimeout(r,25*(attempt+1)));}
  }
}
