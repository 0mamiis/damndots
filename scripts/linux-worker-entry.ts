import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {ComputerWorker} from '../apps/worker/src/worker.js';
import {acquireLaunchLock} from '../apps/client/src/launch-policy.js';
const data=process.env.DOTS_LINUX_DATA_DIR||'/home/dot/.dots';if(data!=='/home/dot/.dots'&&!/^\/home\/dot\/\.dots\/hosts\/[A-Za-z0-9-]+$/.test(data))throw Error('Invalid Linux host data directory');await mkdir(data,{recursive:true});const release=await acquireLaunchLock(join(data,'worker.lock'));if(!release){console.log('Linux computer worker already running.');process.exit(0);}
const config=JSON.parse(await readFile(join(data,'runtime.json'),'utf8'));
process.env.DOTS_CODEX_CLI='/usr/local/bin/codex';
process.env.DOTS_WORKER_MODEL=config.defaultModel||'anthropic/claude-sonnet-5-5';
const worker=new ComputerWorker({server:config.server||'http://127.0.0.1:19340',enrollment:config.enrollment,dataDir:data,roots:['/home/dot/Workspace'],browserExecutable:['/usr/bin/chromium','/usr/bin/google-chrome-stable'].find(p=>existsSync(p)),name:'Dot Linux computer',desktop:true});
let stopped=false;const stop=async()=>{if(stopped)return;stopped=true;await worker.stop();await release();process.exit(0);};
process.once('SIGTERM',()=>{void stop();});process.once('SIGINT',()=>{void stop();});process.stdin.resume();process.stdin.on('end',()=>{void stop();});
await writeFile(join(data,'worker.pid'),String(process.pid),{mode:0o600});
try{await worker.start();}finally{await release();}
