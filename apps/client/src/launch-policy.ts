import { mkdir } from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, rmdirSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export type LaunchAction='focus'|'dots'|'installed';
export function launchAction(running:boolean,gatewayReady:boolean):LaunchAction {
  return running?'focus':gatewayReady?'dots':'installed';
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
          try{process.kill(owner.pid!,0);return;}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}
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
  throw new Error('Açılış kilidi temizlenemedi: '+directory);
}
