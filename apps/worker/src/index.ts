import { ComputerWorker } from './worker.js';
import { resolve } from 'node:path';
const args=process.argv.slice(2),values=(key:string)=>args.flatMap((v,i)=>v===key&&args[i+1]?[args[i+1]]:[]);
const roots=values('--root');if(!roots.length)throw new Error('Choose an explicit workspace with --root');
const worker=new ComputerWorker({server:values('--server')[0]||process.env.DOTS_SERVER_URL||'http://127.0.0.1:9340',enrollment:values('--enrollment')[0]||process.env.DOTS_WORKER_ENROLLMENT,dataDir:resolve(process.env.DOTS_WORKER_DATA_DIR||'.data/worker'),roots,appServerUrl:process.env.DOTS_WORKER_APPSERVER_URL,browserExecutable:process.env.DOTS_BROWSER_EXECUTABLE,name:values('--name')[0],computerMode:process.env.DOTS_COMPUTER_MODE==='browser'?'browser':'pc'});
for(const sig of ['SIGINT','SIGTERM'] as const)process.once(sig,async()=>{await worker.stop();process.exit(0);});
console.log('Starting computer worker; credentials stay in its private data directory.');
await worker.start();
