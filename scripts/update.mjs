import {readFile,writeFile,mkdir,rename,unlink,open,stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
const exec=promisify(execFile);
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export async function atomic(path,value){const t=path+'.'+randomUUID()+'.tmp';await writeFile(t,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(t,path);}
export async function command(file,args,cwd){
  return new Promise((yes,no)=>{let timedOut=false;const child=spawn(file,args,{cwd,env:process.env,windowsHide:true,stdio:['ignore','inherit','inherit'],detached:process.platform!=='win32'});const timer=setTimeout(()=>{timedOut=true;void (async()=>{if(process.platform==='win32')await exec('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true}).catch(()=>{});else try{process.kill(-child.pid,'SIGKILL');}catch{}no(Error('Command timed out'));})();},15*60*1000);child.once('error',e=>{clearTimeout(timer);no(e);});child.once('exit',code=>{clearTimeout(timer);code===0&&!timedOut?yes():no(Error(timedOut?'Command timed out':'Command failed ('+code+')'));});});
}
export function validateJob(job,jobFile,root){
  if(!job||!/^v\d+\.\d+\.\d+$/.test(job.target)||! /^[a-f0-9-]{36}$/.test(job.id)||!Number.isSafeInteger(job.stackPid)||job.stackPid<1)throw Error('Invalid update job');
  if(resolve(jobFile)!==join(resolve(process.env.DOTS_UPDATE_DATA||join(root,'apps/server/.data/server')),'updates/job.json'))throw Error('Unexpected job path');
}
async function npmCli(){
  const node=dirname(process.execPath);
  const candidates=[join(node,'node_modules/npm/bin/npm-cli.js'),join(node,'../lib/node_modules/npm/bin/npm-cli.js'),process.env.npm_execpath].filter(Boolean);
  for(const f of candidates)if(f.endsWith('npm-cli.js')&&existsSync(f))return resolve(f);
  throw Error('npm CLI could not be found next to Node.js');
}
async function git(args,root){return (await exec('git',args,{cwd:root,windowsHide:true,maxBuffer:8*1024*1024})).stdout.trim();}
export async function verifyCheckout(root){
  const origin=(await git(['remote','get-url','origin'],root)).replace(/\.git$/,'');
  if(!['https://github.com/0mamiis/damndots','git@github.com:0mamiis/damndots'].includes(origin))throw Error('Unexpected Git origin');
  if(await git(['status','--porcelain','--untracked-files=no'],root))throw Error('Local source changes detected; update stopped');
  if(await git(['ls-files','--others','--exclude-standard'],root))throw Error('Untracked source files detected; back them up before updating');
}
export async function performUpdate({root,jobFile,prepare,stop,install,restart,health,rollback}){
  let job=JSON.parse(await readFile(jobFile,'utf8')),changed=false,stopped=false;
  const set=async(status,step)=>{job={...job,status,step,updatedAt:new Date().toISOString()};await atomic(jobFile,job);};
  try {
    await set('preparing','Downloading and checking the release');
    await prepare(job);
    await set('ready','Waiting for Dots services to stop');
    await stop(job);stopped=true;
    await set('applying','Installing the checked release');
    changed=true;await install(job);
    await set('restarting','Restarting Dots');
    await restart(job);await health(job.target);
    await set('completed','Update installed');
  }catch(error){
    console.error('Update failed:',error instanceof Error?error.message:'unknown error');
    if(stopped){
      try{
        await set('rolling_back','Restoring the previous version');
        if(changed)await rollback(job);
        await restart(job);await health(null);
        await set('rolled_back','Update failed. The previous version was restored.');
      }catch{
        await set('failed','Update failed. Close Dots and run Start-Dots. See the local update log.');
      }
    }else await set('failed','Update preparation failed. Your installation was kept. See the local update log.');
    throw error;
  }finally{await unlink(join(dirname(jobFile),'update.lock')).catch(()=>{});}
}
async function main(){
  const jobFile=resolve(process.argv[process.argv.indexOf('--job')+1]||'');
  let job=JSON.parse(await readFile(jobFile,'utf8'));validateJob(job,jobFile,ROOT);
  const data=dirname(jobFile),stage=join(data,'stage-'+job.id);
  const lockId=await readFile(join(data,'update.lock'),'utf8');if(lockId!==job.id)throw Error('Update lock mismatch');
  await atomic(join(data,'updater.json'),{id:job.id,pid:process.pid});
  const npm=await npmCli(),runNpm=(args,cwd)=>command(process.execPath,[npm,...args],cwd);
  const previous=await git(['rev-parse','HEAD'],ROOT);
  await mkdir(join(data,'backups'),{recursive:true});
  await atomic(join(data,'backups',job.id+'.json'),{previous,target:job.target,createdAt:new Date().toISOString()});
  let target;
  const startupArgs=JSON.parse(process.env.DOTS_MANAGED_STACK_ARGS||'[]');
  if(!Array.isArray(startupArgs)||startupArgs.some(a=>!['--worker','--client','--main-gateway'].includes(a)))throw Error('Unsupported stack launch arguments');
  const restart=async()=>{
    const log=await open(join(data,'restart.log'),'a',0o600);
    try{
      const child=spawn(process.execPath,['--env-file-if-exists=.env','--import','tsx','scripts/local-stack.ts',...startupArgs],{cwd:ROOT,env:process.env,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
      await new Promise((ok,no)=>{child.once('spawn',ok);child.once('error',no);});child.unref();
    }finally{await log.close();}
  };
  const port=Number(process.env.DOTS_PORT||9340);
  const health=async(tag)=>{
    for(let i=0;i<90;i++){
      try{const r=await fetch('http://127.0.0.1:'+port+'/health',{signal:AbortSignal.timeout(2000)});const s=await r.json();if(r.ok&&s.ok&&(!tag||s.version===tag.replace(/^v/,''))){
        const ready=JSON.parse(await readFile(join(process.env.DOTS_STACK_DIR||join(ROOT,'.data/local-stack'),'ready.json'),'utf8'));
        const supervisor=JSON.parse(await readFile(join(process.env.DOTS_STACK_DIR||join(ROOT,'.data/local-stack'),'supervisor.json'),'utf8'));
        const dashboard=await fetch('http://127.0.0.1:'+Number(process.env.DOTS_DASHBOARD_PORT||4320),{signal:AbortSignal.timeout(2000)});
        if(ready.pid===supervisor.pid&&ready.pid!==job.stackPid&&dashboard.ok)return;
      }}catch{}
      await sleep(2000);
    }throw Error('The restarted server did not become healthy');
  };
  try {await performUpdate({
    root:ROOT,jobFile,
    prepare:async()=>{
      await verifyCheckout(ROOT);
      await command('git',['fetch','--no-tags','origin','refs/tags/'+job.target],ROOT);
      target=await git(['rev-parse','FETCH_HEAD^{commit}'],ROOT);
      await command('git',['merge-base','--is-ancestor',previous,target],ROOT);
      await command('git',['worktree','add','--detach',stage,target],ROOT);
      const pkg=JSON.parse(await readFile(join(stage,'package.json'),'utf8'));
      if(pkg.version!==job.target.replace(/^v/,''))throw Error('Release tag and package version disagree');
      await runNpm(['ci','--no-audit','--no-fund'],stage);
      await runNpm(['run','typecheck'],stage);
      await runNpm(['run','build'],stage);
    },
    stop:async()=>{
      await atomic(join(data,'stop-request.json'),{id:job.id,stackPid:job.stackPid});
      // The supervisor shuts down only its own children and acknowledges.
      for(let i=0;i<90;i++){
        try{const ack=JSON.parse(await readFile(join(data,'stopped.json'),'utf8'));if(ack.id===job.id&&ack.stackPid===job.stackPid)return;}catch{}
        await sleep(1000);
      }throw Error('Managed stack did not acknowledge shutdown');
    },
    install:async()=>{
      await verifyCheckout(ROOT);
      // Refuse concurrent user changes rather than discarding them.
      if(await git(['rev-parse','HEAD'],ROOT)!==previous)throw Error('The source changed while the update was preparing');
      await command('git',['merge','--ff-only',target],ROOT);
      await runNpm(['ci','--no-audit','--no-fund'],ROOT);
      await runNpm(['run','build'],ROOT);
    },
    restart,health,
    rollback:async()=>{
      // Stop an unhealthy replacement before restoring files and dependencies.
      try {
        const stack=JSON.parse(await readFile(join(process.env.DOTS_STACK_DIR||join(ROOT,'.data/local-stack'),'supervisor.json'),'utf8'));
        if(stack.pid!==job.stackPid){
          await atomic(join(data,'stop-request.json'),{id:job.id,stackPid:stack.pid});
          let stopped=false;
          for(let i=0;i<30;i++){try{const ack=JSON.parse(await readFile(join(data,'stopped.json'),'utf8'));if(ack.id===job.id&&ack.stackPid===stack.pid){stopped=true;break;}}catch{}await sleep(1000);}
          if(!stopped)throw Error('Replacement stack did not stop');
        }
      }catch(e){if(e.code!=='ENOENT')throw e;}
      // --keep refuses to overwrite user changes made while updating.
      await command('git',['reset','--keep',previous],ROOT);
      await runNpm(['ci','--no-audit','--no-fund'],ROOT);
      await runNpm(['run','build'],ROOT);
    }
  });} finally {
    // This is the exact worktree created for this job, never the installation or user data directory.
    if(existsSync(stage))await exec('git',['worktree','remove','--force',stage],{cwd:ROOT,windowsHide:true}).catch(()=>{});
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  main().catch(async(error)=>{
    console.error('Updater bootstrap failed:',error instanceof Error?error.message:'unknown error');
    // Early bootstrap failures must not leave a permanent maintenance lock.
    try{
      const f=resolve(process.argv[process.argv.indexOf('--job')+1]);const j=JSON.parse(await readFile(f,'utf8'));validateJob(j,f,ROOT);
      if(['preparing','ready'].includes(j.status)){await atomic(f,{...j,status:'failed',step:'Could not prepare the update; installation preserved.',updatedAt:new Date().toISOString()});await unlink(join(dirname(f),'update.lock')).catch(()=>{});}
    }catch{}
    process.exitCode=1;
  });
}
