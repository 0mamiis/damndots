import {readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
/** Only the supervisor consumes update stop requests. It stops its own child processes, never a global PID/name search. */
export function watchUpdateStop({data,updates,pid,shutdown}:{data:string;updates:string;pid:number;shutdown:()=>Promise<void>}){
  let stopping=false;
  const timer=setInterval(()=>{
    if(stopping)return;
    void (async()=>{
      let request:any;
      try{request=JSON.parse(await readFile(join(updates,'stop-request.json'),'utf8'));}catch{return;}
      if(request.stackPid!==pid||typeof request.id!=='string')return;
      try{
        const job=JSON.parse(await readFile(join(updates,'job.json'),'utf8'));
        if(job.id!==request.id||!['ready','rolling_back'].includes(job.status))return;
      }catch{return;}
      stopping=true;clearInterval(timer);
      try {
        await shutdown();
        const path=join(updates,'stopped.json'),temp=path+'.tmp';
        await writeFile(temp,JSON.stringify({id:request.id,stackPid:pid}),{mode:0o600});await rename(temp,path);
        process.exit(0);
      }catch{process.exitCode=1;}
    })();
  },1000);timer.unref();return ()=>clearInterval(timer);
}
