import {execFileSync} from 'node:child_process';
import {DISTRO} from './linux-computer/distro.mjs';
if(process.platform!=='win32')throw Error('This helper requires Windows and WSL2.');
const read=path=>execFileSync('wsl.exe',['-d',DISTRO,'-u','dot','--exec','cat',path],{encoding:'utf8',windowsHide:true});
const pid=JSON.parse(read('/home/dot/.dots/worker.lock/owner.json')).pid;
if(!Number.isSafeInteger(pid)||pid<2)throw Error('Invalid Linux worker owner');
if(!read('/proc/'+pid+'/cmdline').includes('scripts/linux-worker-entry.ts'))throw Error('Linux worker identity mismatch');
execFileSync('wsl.exe',['-d',DISTRO,'-u','dot','--exec','kill','-TERM',String(pid)],{windowsHide:true});
console.log('Linux worker asked to stop gracefully. The running Dots service supervisor will restart it.');
