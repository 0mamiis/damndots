import { mkdir } from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, rmdirSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

export type LaunchAction='focus'|'dots'|'installed';
export function launchAction(running:boolean,gatewayReady:boolean):LaunchAction {
  return running?'focus':gatewayReady?'dots':'installed';
}
/** A live PID is not proof that the lock owner is alive: Windows reuses PIDs. A process that started after the lock was written cannot be its owner. */
export function pidReused(pid:number,lockedAtMs:number):boolean {
  try{
    const out=process.platform==='win32'
      ?execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','(Get-Process -Id '+pid+').StartTime.ToUniversalTime().ToString(\'o\')'],{encoding:'utf8',timeout:15000,windowsHide:true})
      :execFileSync('ps',['-o','lstart=','-p',String(pid)],{encoding:'utf8',timeout:5000,env:{...process.env,LC_ALL:'C'}});
    const started=Date.parse(out.trim());
    return Number.isFinite(started)&&started>lockedAtMs+2000;
  }catch{return false;}
}
/** Aynı simgeye çift tıklayınca eşzamanlı iki Codex süreci açılmasını engeller. */
export async function acquireLaunchLock(directory:string):Promise<(()=>Promise<void>)|undefined> {
  await mkdir(join(directory,'..'),{recursive:true});
  const ownerFile=join(directory,'owner.json'),token=randomUUID();
  for(let attempt=0;attempt<20;attempt++){
    try{
      mkdirSync(directory);
      writeFileSync(ownerFile,JSON.stringify({pid:process.pid,token}),{flag:'wx'});
      let released=false;
      // Node's exit event cannot finish asynchronous file operations. Both removals
      // must finish in this call, otherwise an empty lock directory is left behind.
      return async()=>{
        if(released)return;released=true;
        try{
          const owner=JSON.parse(readFileSync(ownerFile,'utf8'));
          if(owner.pid!==process.pid||owner.token!==token)return;
          unlinkSync(ownerFile);rmdirSync(directory);
        }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      };
    }catch(error){
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      try{
        let raw:string|undefined,owner:{pid?:number}|undefined;
        try{raw=readFileSync(ownerFile,'utf8');owner=JSON.parse(raw);}catch(error){
          if(!(error instanceof SyntaxError)&&(error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
        }
        if(owner&&Number.isSafeInteger(owner.pid)&&owner.pid!>0){
          // ESRCH: process is gone. EPERM: the PID was reused by a process of another account (for example a
          // Windows service), which can never be this user's launcher, so the lock is stale in both cases.
          try{process.kill(owner.pid!,0);if(!pidReused(owner.pid!,statSync(ownerFile).mtimeMs))return;}catch(e){if(!['ESRCH','EPERM'].includes((e as NodeJS.ErrnoException).code||''))throw e;}
        }else if(Date.now()-statSync(directory).mtimeMs<1000){
          // Another launch may be between mkdir and writing owner.json.
          await new Promise(r=>setTimeout(r,100));continue;
        }
        if(raw!==undefined){if(readFileSync(ownerFile,'utf8')!==raw)continue;unlinkSync(ownerFile);}
        rmdirSync(directory); // only an empty, abandoned lock can be removed
      }catch(error){
        if(!['ENOENT','ENOTEMPTY','EEXIST'].includes((error as NodeJS.ErrnoException).code||''))throw error;
        await new Promise(r=>setTimeout(r,100));
      }
    }
  }
  throw new Error('The launch lock could not be cleared: '+directory);
}
