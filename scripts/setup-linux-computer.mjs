import {DISTRO} from './linux-computer/distro.mjs';
import {spawn,execFileSync} from 'node:child_process';import {writeFileSync} from 'node:fs';import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..');if(process.platform!=='win32')throw Error('This installer requires Windows with WSL2.');
const run=script=>new Promise((yes,no)=>{const p=spawn(process.execPath,[join(root,'scripts',script)],{cwd:root,windowsHide:true,stdio:'inherit'});p.once('error',no);p.once('exit',code=>code===0?yes():no(Error(script+' failed '+code)));});
await run(DISTRO==='Dots-Computer'?'install-linux-computer.mjs':'install-debian-computer.mjs');
let readyImage=false;try{execFileSync('wsl.exe',['-d',DISTRO,'-u','root','--exec','test','-f','/usr/local/share/damndots-image/image.json'],{windowsHide:true,stdio:'ignore'});readyImage=true;}catch{}
if(readyImage){const p=spawn('wsl.exe',['-d',DISTRO,'-u','root','--exec','bash','-s'],{windowsHide:true,stdio:['pipe','pipe','pipe']});const {createReadStream}=await import('node:fs');createReadStream(join(root,'scripts/linux-computer/initialize-image.sh')).pipe(p.stdin);p.stdout.pipe(process.stdout);p.stderr.pipe(process.stderr);const code=await new Promise(r=>{p.once('exit',r);p.once('error',()=>r(-1));});if(code!==0)throw Error('Ready image initialization failed');}
let configured=false;try{execFileSync('wsl.exe',['-d',DISTRO,'-u','root','--exec','test','-f','/home/dot/.dots/installed'],{windowsHide:true,stdio:'ignore'});configured=true;}catch{}
if(!configured){await run('configure-linux-computer.mjs');execFileSync('wsl.exe',['--terminate',DISTRO],{windowsHide:true});}
await run('install-linux-apps.mjs');await run('prepare-linux-tunnel.mjs');await run('sync-linux-computer.mjs');
// Dependency installation is required only once. Source-only updates reuse it.
try{execFileSync('wsl.exe',['-d',DISTRO,'-u','dot','--exec','test','-d','/opt/dots/node_modules/tsx'],{windowsHide:true,stdio:'ignore'});}catch{const p=spawn(process.execPath,[join(root,'scripts/sync-linux-computer.mjs'),'--install-deps'],{cwd:root,windowsHide:true,stdio:'inherit'});const code=await new Promise(r=>p.once('exit',r));if(code!==0)throw Error('Linux dependencies failed');}
await run('migrate-linux-workspace.mjs');writeFileSync(join(root,'.data/linux-computer/enabled'),'enabled');writeFileSync(join(root,'.data/linux-computer/active-distro'),DISTRO);
console.log('Linux computer setup complete. Start the existing Dots services; no Codex window is opened.');
