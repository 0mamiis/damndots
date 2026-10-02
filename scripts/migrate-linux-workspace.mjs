import {DISTRO} from './linux-computer/distro.mjs';
import {execFileSync,spawn} from 'node:child_process';import fs from 'node:fs';import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),source=join(root,'.data/local-stack/workspace'),archive=join(root,'.data/linux-computer/workspace-transfer.tar');
if(!fs.existsSync(source)){console.log('No existing Windows Dot workspace to transfer.');process.exit(0);}
execFileSync('tar.exe',['-cf',archive,'-C',source,'.'],{windowsHide:true});
const p=spawn('wsl.exe',['-d',DISTRO,'-u','dot','--exec','sh','-c','mkdir -p /home/dot/Workspace; tar --skip-old-files -xf - -C /home/dot/Workspace'],{windowsHide:true,stdio:['pipe','pipe','pipe']});fs.createReadStream(archive).pipe(p.stdin);p.stderr.on('data',b=>process.stderr.write(b));const code=await new Promise(r=>p.once('exit',r));fs.unlinkSync(archive);if(code!==0)throw Error('Workspace transfer failed '+code);console.log('Existing Dot files copied to Linux; existing Linux files were kept.');
