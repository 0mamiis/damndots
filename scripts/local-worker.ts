import {join,resolve} from 'node:path';
import {acquireLaunchLock} from '../apps/client/src/launch-policy.js';
const data=resolve(process.env.DOTS_WORKER_DATA_DIR||'.data/local-stack/worker');
const release=await acquireLaunchLock(join(data,'worker.lock'));
if(!release){console.log('Yerel bilgisayar servisi zaten açık.');process.exit(0);}
process.once('exit',()=>{void release();});
const parent=Number(process.env.DOTS_WORKER_SUPERVISOR_PID);
const watch=parent>0?setInterval(()=>{
 try{process.kill(parent,0);}catch{clearInterval(watch!);process.emit('SIGTERM','SIGTERM');}
},2000):undefined;
try{await import('../apps/worker/src/index.js');}finally{if(watch)clearInterval(watch);await release();}
