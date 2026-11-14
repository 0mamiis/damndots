import {spawn} from 'node:child_process';
import {openSync,closeSync,statSync,renameSync} from 'node:fs';
// rotate-helper: keeps one old generation (<log>.1); never throws, a locked file is simply appended to.
const rotateLog=(f,max)=>{try{if(statSync(f).size>max)renameSync(f,f+'.1');}catch{}};
// Starts a process that is not a descendant of the caller. On Windows, stopping a service tree with
// taskkill /T would otherwise also stop an updater that was started by one of those services.
// Usage: node detach.mjs <logFile> <cwd> <command> [args...]
const [log,cwd,command,...args]=process.argv.slice(2);
if(!log||!cwd||!command)process.exit(2);
rotateLog(log,5*1024*1024);
const fd=openSync(log,'a',0o600);
const child=spawn(command,args,{cwd,env:process.env,detached:true,stdio:['ignore',fd,fd],windowsHide:true});
child.once('error',error=>{console.error(error.message);process.exit(1);});
child.once('spawn',()=>{child.unref();closeSync(fd);process.exit(0);});
