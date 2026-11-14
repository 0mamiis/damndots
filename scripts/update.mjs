import {readFile,writeFile,mkdir,rename,unlink,open,readlink} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import net from 'node:net';
const exec=promisify(execFile);
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
/** Windows refuses to replace a directory while a process still has it as its working directory or has its files open. */
export function isTreeLockError(error){
  return /\b(EBUSY|EPERM)\b/.test(String(error&&error.output||''));
}
/** One retry only: release the tree again after Windows reports a locked file, then build once more. */
export async function retryBuildOnTreeLock(build,freeTree){
  try{return await build();}
  catch(error){
    if(!isTreeLockError(error))throw error;
    await freeTree(error);
    return build();
  }
}
function normaliseTreePath(value,insensitive){
  const text=String(value||'').replace(/\//g,'\\');
  return insensitive?text.toLowerCase():text;
}
function pathContainsRoot(value,root){
  let from=0;
  for(;;){
    const at=value.indexOf(root,from);
    if(at<0)return false;
    const next=value[at+root.length];
    // End of string, a path separator or punctuation (quotes, parentheses, commas) ends the repo path.
    if(next===undefined||!/[A-Za-z0-9_.-]/.test(next))return true;
    from=at+1;
  }
}
function hasTreeMarker(value){
  const text=String(value||'').replace(/\//g,'\\').toLowerCase();
  return /(?:^|\\)\.next(?:\\|$|["'])/.test(text)
    ||/(?:^|\\)dashboard(?:\\|$|["'])/.test(text)
    ||/(?:^|\\)local-stack\.(?:ts|mjs|js)(?=$|[\s"'])/.test(text)
    ||/(?:^|\s)tsx(?:\s|$)/.test(text)
    ||/(?:^|\\)tsx(?:\\|$|["'])/.test(text);
}
/** A relative script name is only meaningful when the same process tree contains the repo root or a managed port. */
function hasRelativeRepoEntry(value){
  return /(?:^|[\s"'])(?:\.[\\/])?(?:scripts[\\/](?:local-stack|appserver)\.(?:ts|mjs|js)|apps[\\/]server[\\/]src[\\/]index\.(?:ts|js)|apps[\\/]dashboard[\\/](?:scripts[\\/]start\.mjs|\.next[\\/]))/i.test(String(value||''));
}
/** Select only processes that can hold the repository tree or one of the managed ports. Never selects by image name. */
export function selectTreeLocks({processes,root,ports=[],excludePids=[],platform=process.platform}){
  const insensitive=platform==='win32';
  const rootText=normaliseTreePath(root,insensitive).replace(/\\+$/,'');
  if(!rootText)return [];
  const managed=new Set(ports.map(Number).filter(port=>Number.isInteger(port)&&port>0&&port<65536));
  const excluded=new Set(excludePids.map(Number));
  const list=processes||[];
  const byPid=new Map(list.map(process=>[Number(process.pid),process]));
  const children=new Map();
  for(const process of list){
    const parent=Number(process.parentPid);
    if(!children.has(parent))children.set(parent,[]);
    children.get(parent).push(Number(process.pid));
  }
  const ownsManagedPort=process=>(process.listeningPorts||[]).some(port=>managed.has(Number(port)));
  const isNodeProcess=process=>{
    const name=String(process.name||'').toLowerCase(),exe=normaliseTreePath(process.exePath,insensitive).toLowerCase(),base=exe.split('\\').pop();
    return insensitive?(base==='node.exe'||name==='node.exe'):(base==='node'||base==='node.exe'||name==='node'||name==='node.exe');
  };
  const hasRepoPath=process=>{
    const commandLine=normaliseTreePath(process.commandLine,insensitive),exePath=normaliseTreePath(process.exePath,insensitive);
    return pathContainsRoot(commandLine,rootText)||pathContainsRoot(exePath,rootText);
  };
  const hasTreeRelation=process=>{
    const commandLine=normaliseTreePath(process.commandLine,insensitive),exePath=normaliseTreePath(process.exePath,insensitive);
    return hasTreeMarker(commandLine)||hasTreeMarker(exePath);
  };
  /** A relative script is only ours when the same tree contains the actual repo path or a managed port. */
  const treeHasRepoEvidence=process=>{
    if(hasRepoPath(process)||ownsManagedPort(process))return true;
    let parent=Number(process.parentPid);
    for(let depth=0;depth<32&&parent>0;depth++){
      const ancestor=byPid.get(parent);
      if(!ancestor)break;
      if(hasRepoPath(ancestor)||ownsManagedPort(ancestor))return true;
      parent=Number(ancestor.parentPid);
    }
    const queue=[...(children.get(Number(process.pid))||[])],seen=new Set();
    for(let index=0;index<queue.length&&index<list.length+1;index++){
      const pid=queue[index];
      if(seen.has(pid))continue;
      seen.add(pid);
      const descendant=byPid.get(pid);
      if(!descendant)continue;
      if(hasRepoPath(descendant)||ownsManagedPort(descendant))return true;
      queue.push(...(children.get(pid)||[]));
    }
    return false;
  };
  const relativeRepoProcess=process=>hasRelativeRepoEntry(process.commandLine)&&treeHasRepoEvidence(process);
  const repoStackProcess=process=>relativeRepoProcess(process)||(hasRepoPath(process)&&hasTreeRelation(process));
  const direct=list.filter(process=>{
    const pid=Number(process&&process.pid);
    if(!Number.isInteger(pid)||pid<1||pid===4||excluded.has(pid))return false;
    return ownsManagedPort(process)||(isNodeProcess(process)&&((hasRepoPath(process)&&hasTreeRelation(process))||relativeRepoProcess(process)));
  });
  // Include the repo ancestors and descendants of every selected service. The updater itself stays excluded.
  const selected=new Set(direct.map(process=>Number(process.pid))),queue=[...selected];
  const add=pid=>{
    if(!excluded.has(pid)&&byPid.has(pid)&&!selected.has(pid)){selected.add(pid);queue.push(pid);}
  };
  for(let index=0;index<queue.length&&index<list.length+1;index++){
    const pid=queue[index];
    let parent=Number(byPid.get(Number(pid))?.parentPid);
    for(let depth=0;depth<32&&parent>0;depth++){
      const process=byPid.get(parent);
      if(!process)break;
      if(isNodeProcess(process)&&repoStackProcess(process))add(parent);
      parent=Number(process.parentPid);
    }
    if(isNodeProcess(byPid.get(pid)))for(const child of children.get(pid)||[]){
      const process=byPid.get(Number(child));
      if(process&&(isNodeProcess(process)||ownsManagedPort(process)))add(Number(child));
    }
  }
  return list.filter(process=>selected.has(Number(process.pid))).sort((a,b)=>Number(a.pid)-Number(b.pid));
}
const WINDOWS_PROCESS_QUERY=`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
$processes=@(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;name=[string]$_.Name;commandLine=[string]$_.CommandLine;exePath=[string]$_.ExecutablePath} })
$listeners=@(netstat -ano | Select-String 'LISTENING' | ForEach-Object {
  $fields=@(($_.Line -split '\\s+') | Where-Object { $_ -ne '' })
  if($fields.Count -ge 5){[pscustomobject]@{pid=[int]$fields[4];port=[int]($fields[1].Split(':')[-1])}}
})
[pscustomobject]@{processes=$processes;listeners=$listeners} | ConvertTo-Json -Depth 4 -Compress
`;
const asArray=value=>Array.isArray(value)?value:value?[value]:[];
async function windowsProcessInventory(){
  const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',WINDOWS_PROCESS_QUERY],{windowsHide:true,maxBuffer:32*1024*1024,timeout:30000});
  const parsed=JSON.parse(String(stdout).replace(/^\uFEFF/,''));
  const processes=asArray(parsed.processes).map(process=>({pid:Number(process.pid),parentPid:Number(process.parentPid),name:String(process.name||''),commandLine:String(process.commandLine||''),exePath:String(process.exePath||''),listeningPorts:[]}));
  const byPid=new Map(processes.map(process=>[process.pid,process]));
  for(const listener of asArray(parsed.listeners)){
    const process=byPid.get(Number(listener.pid));
    if(process&&!process.listeningPorts.includes(Number(listener.port)))process.listeningPorts.push(Number(listener.port));
  }
  return processes;
}
function managedTreePorts(){return [process.env.DOTS_DASHBOARD_PORT||4320,process.env.DOTS_PORT||9340,process.env.DOTS_APPSERVER_PORT||9912].map(Number).filter(port=>Number.isInteger(port)&&port>0&&port<65536);}
const portIsOpen=port=>new Promise(done=>{const socket=net.connect(port,'127.0.0.1');socket.once('connect',()=>{socket.destroy();done(true);});socket.once('error',()=>done(false));socket.setTimeout(500,()=>{socket.destroy();done(false);});});
async function waitForManagedPorts(ports,limit=10000){
  const deadline=Date.now()+limit;
  for(;;){
    const open=[];for(const port of ports)if(await portIsOpen(port))open.push(port);
    if(!open.length||Date.now()>=deadline)return open;
    await sleep(250);
  }
}
const parsePids=stdout=>String(stdout||'').split(/\s+/).filter(Boolean).map(Number).filter(pid=>Number.isInteger(pid)&&pid>0);
export async function readListeningPids(port,runLsof){
  const run=runLsof||(()=>exec('lsof',['-ti','tcp:'+port,'-sTCP:LISTEN'],{windowsHide:true,maxBuffer:1024*1024}));
  try{return parsePids((await run()).stdout);}
  catch(first){
    // lsof exits 1 with no stderr when nothing matches; that is an empty result, not an inventory failure.
    if((first.code===1||first.code==='1')&&!String(first.stderr||'').trim())return parsePids(first.stdout);
    try{return parsePids((await run()).stdout);}
    catch(second){throw Error('Could not inspect processes listening on port '+port+': '+errorLine(second));}
  }
}
async function freeUnixManagedPorts({root,ports,label}){
  const listening=new Map();
  for(const port of ports){
    for(const pid of await readListeningPids(port)){
      const list=listening.get(pid)||[];list.push(port);listening.set(pid,list);
    }
  }
  const candidates=[];
  for(const [pid,listeningPorts] of listening){
    let commandLine='',exePath='',cwd='';
    try{commandLine=(await readFile('/proc/'+pid+'/cmdline')).toString('utf8').replace(/\0/g,' ').trim();}catch{}
    try{exePath=await readlink('/proc/'+pid+'/exe');}catch{}
    try{cwd=await readlink('/proc/'+pid+'/cwd');}catch{}
    candidates.push({pid,commandLine:commandLine+' '+cwd,exePath,listeningPorts});
  }
  const selected=selectTreeLocks({processes:candidates,root,ports,excludePids:[process.pid,process.ppid],platform:process.platform});
  if(selected.length)console.log('Releasing '+selected.length+' process(es) holding the update tree'+(label?' ('+label+')':'')+': '+selected.map(candidate=>candidate.pid).join(', '));
  for(const candidate of selected){try{process.kill(candidate.pid,'SIGTERM');}catch{}}
  if(selected.length){await sleep(1000);for(const candidate of selected){try{process.kill(candidate.pid,'SIGKILL');}catch{}}}
  const busy=await waitForManagedPorts(ports);
  if(busy.length)throw Error('Managed ports are still in use after stopping Dots: '+busy.join(', '));
}
const killWindowsProcess=pid=>exec('taskkill.exe',['/PID',String(pid),'/T','/F'],{windowsHide:true,maxBuffer:1024*1024});
const errorLine=error=>String(error instanceof Error?error.message:error).split(/\r?\n/)[0];
/** Release the live tree. Inventory failures and ports that stay busy are update failures, never warnings. */
export async function releaseLockedTree({
  root,ports=managedTreePorts(),platform=process.platform,excludePids=[],protectPids=[],label='',
  inventory=windowsProcessInventory,kill=killWindowsProcess,waitForPorts=waitForManagedPorts,log=console.log,error=console.error
}={}){
  if(platform!=='win32')return freeUnixManagedPorts({root,ports,label});
  const readInventory=async()=>{
    try{return await inventory();}
    catch(first){
      try{return await inventory();}
      catch(second){throw Error('Could not inspect repository processes: '+errorLine(second));}
    }
  };
  const current=await readInventory();
  const byPid=new Map(current.map(candidate=>[Number(candidate.pid),candidate]));
  const excluded=new Set(excludePids.map(Number));
  for(const pid of protectPids)excluded.add(Number(pid));
  for(const start of protectPids){
    let cursor=Number(byPid.get(Number(start))?.parentPid);
    if(!cursor&&Number(start)===process.pid)cursor=process.ppid;
    for(let depth=0;depth<32&&cursor>0;depth++){
      excluded.add(cursor);
      const parent=byPid.get(cursor);
      if(!parent)break;
      cursor=Number(parent.parentPid);
    }
  }
  const select=processes=>selectTreeLocks({processes,root,ports,excludePids:[...excluded],platform});
  const killSelected=async processes=>{
    if(!processes.length)return;
    log('Releasing '+processes.length+' process(es) holding the update tree'+(label?' ('+label+')':'')+': '+processes.map(candidate=>candidate.pid+(candidate.name?' ('+candidate.name+')':'')).join(', '));
    for(const candidate of processes)log('  '+candidate.pid+' '+String(candidate.commandLine||candidate.exePath||'').slice(0,240));
    for(const candidate of processes){
      try{await kill(candidate.pid);}
      catch(failure){error('Could not stop process '+candidate.pid+': '+errorLine(failure));}
    }
  };
  const selected=select(current);
  await killSelected(selected);
  let busy=await waitForPorts(ports);
  let after=await readInventory();
  const remaining=select(after);
  if(remaining.length){
    await killSelected(remaining);
    busy=await waitForPorts(ports);
    after=await readInventory();
  }
  if(busy.length)throw Error('Managed ports are still in use after stopping Dots: '+busy.join(', '));
  const alive=new Set(after.map(candidate=>Number(candidate.pid)));
  const left=[...new Set([...selected.map(candidate=>Number(candidate.pid)),...remaining.map(candidate=>Number(candidate.pid)),...select(after).map(candidate=>Number(candidate.pid))].filter(pid=>alive.has(pid)))];
  if(left.length)throw Error('Repository processes are still holding files: '+left.join(', '));
}
/** Windows can refuse a rename for a moment while a scanner or reader holds the target; the status file must still be updated. */
export async function renameWithRetry(from,to){
  for(let attempt=0;;attempt++){
    try{await rename(from,to);return;}
    catch(error){if(!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt>=10){await unlink(from).catch(()=>{});throw error;}await sleep(25*(attempt+1));}
  }
}
export async function atomic(path,value){const t=path+'.'+randomUUID()+'.tmp';await writeFile(t,JSON.stringify(value,null,2)+'\n',{mode:0o600});await renameWithRetry(t,path);}
export async function command(file,args,cwd,options={}){
  const capture=options.capture===true;
  return new Promise((yes,no)=>{let timedOut=false,output='';const child=spawn(file,args,{cwd,env:process.env,windowsHide:true,stdio:capture?['ignore','pipe','pipe']:['ignore','inherit','inherit'],detached:process.platform!=='win32'});const append=(chunk,sink)=>{sink.write(chunk);output=(output+chunk.toString()).slice(-256*1024);};if(capture){child.stdout?.on('data',chunk=>append(chunk,process.stdout));child.stderr?.on('data',chunk=>append(chunk,process.stderr));}const fail=error=>{if(capture)error.output=output;no(error);};const timer=setTimeout(()=>{timedOut=true;void (async()=>{if(process.platform==='win32')await exec('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true}).catch(()=>{});else try{process.kill(-child.pid,'SIGKILL');}catch{}fail(Error('Command timed out'));})();},15*60*1000);child.once('error',e=>{clearTimeout(timer);fail(e);});child.once('close',code=>{clearTimeout(timer);code===0&&!timedOut?yes():fail(Error(timedOut?'Command timed out':'Command failed ('+code+')'));});});
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
/** True when any file that defines installed dependencies changed (or when that cannot be determined). */
export function needsInstall(changedFiles){
  return !Array.isArray(changedFiles)||changedFiles.some(f=>/(^|\/)package(-lock)?\.json$/.test(f));
}
async function dependenciesChanged(root,from,to){
  try{return needsInstall((await git(['diff','--name-only',from,to],root)).split(/\r?\n/).filter(Boolean));}catch{return true;}
}
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
  const npm=await npmCli(),runNpm=(args,cwd,options)=>command(process.execPath,[npm,...args],cwd,options);
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
  /** The supervisor only knows its own children; a dashboard or dev process started elsewhere can still lock .next. */
  const freeTree=async(label)=>releaseLockedTree({root:ROOT,ports:managedTreePorts(),platform:process.platform,protectPids:[process.pid],label});
  const buildLive=async()=>{
    let attempt=0;
    return retryBuildOnTreeLock(
      async()=>{attempt++;if(attempt>1)console.log('Build hit a locked file; released the tree and retrying once.');return runNpm(['run','build'],ROOT,{capture:true});},
      async()=>{await freeTree('build retry');}
    );
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
      // A dashboard or dev process started outside the supervisor can still hold .next or node_modules.
      await freeTree('before install and build');
      // Reinstalling takes minutes while Dots is down; the staged copy already proved a clean install works.
      if(await dependenciesChanged(ROOT,previous,target))await runNpm(['ci','--no-audit','--no-fund'],ROOT);
      await buildLive();
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
      await freeTree('before rollback install and build');
      if(await dependenciesChanged(ROOT,previous,target))await runNpm(['ci','--no-audit','--no-fund'],ROOT);
      await buildLive();
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
