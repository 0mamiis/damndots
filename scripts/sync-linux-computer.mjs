import {DISTRO} from './linux-computer/distro.mjs';
import fs from 'node:fs';import {spawn,execFileSync} from 'node:child_process';import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),dir=join(root,'.data/linux-computer');fs.mkdirSync(dir,{recursive:true});
const archive=join(dir,'worker-source.tar');
execFileSync('tar.exe',['-cf',archive,'--exclude=node_modules','--exclude=.data','--exclude=.next','--exclude=work','--exclude=.git','--exclude=.env','--exclude=.env.local','--exclude=*.log','--exclude=*.tsbuildinfo','-C',root,'package.json','package-lock.json','tsconfig.base.json','apps','packages','scripts'],{windowsHide:true});
const setup=process.argv.includes('--install-deps');
const command='mkdir -p /opt/dots && tar -xf - -C /opt/dots'+(setup?' && cd /opt/dots && npm ci --workspace @dots/worker --workspace @dots/server --include-workspace-root --no-audit --no-fund && chown -R root:root /opt/dots':'');
const child=spawn('wsl.exe',['-d',DISTRO,'-u','root','--exec','sh','-c',command],{windowsHide:true,stdio:['pipe','pipe','pipe']});fs.createReadStream(archive).pipe(child.stdin);const log=fs.createWriteStream(join(dir,'source-sync.log'));child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
const code=await new Promise(r=>child.once('exit',r));log.end();console.log('Linux worker source sync',code===0?'complete':'failed '+code);process.exitCode=code??1;
