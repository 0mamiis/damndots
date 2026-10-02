import {DISTRO} from './linux-computer/distro.mjs';
import {spawn} from 'node:child_process';import {createReadStream,createWriteStream} from 'node:fs';import {mkdir} from 'node:fs/promises';import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),dir=join(root,'.data/linux-computer');await mkdir(dir,{recursive:true});
const child=spawn('wsl.exe',['-d',DISTRO,'-u','root','--exec','bash','-s'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
createReadStream(join(root,'scripts/linux-computer/'+(DISTRO==='Dots-Computer'?'bootstrap.sh':'bootstrap-debian.sh'))).pipe(child.stdin);
const log=createWriteStream(join(dir,'setup.log'));child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
child.stdout.on('data',b=>{for(const l of b.toString().split('\n'))if(/^(Updating|Installing|Linux|v24|codex-cli|Blender|.* OK$)/.test(l))process.stdout.write(l+'\n');});
const code=await new Promise(r=>child.once('exit',r));log.end();console.log('Package setup exit',code);process.exitCode=code??1;
