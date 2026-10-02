import {spawn} from 'node:child_process';
import {DISTRO} from './linux-computer/distro.mjs';
/** Copies the Dot computer identity, thread history and files from another WSL distribution. Existing files in the target are kept. */
const source=process.argv[2];
if(!source||source===DISTRO||!/^[A-Za-z0-9._-]{1,64}$/.test(source))throw Error('Usage: node scripts/migrate-linux-state.mjs <source distribution>; it must differ from the active one');
const exclude=['--exclude=.dots/browser','--exclude=.dots/worker.lock','--exclude=.dots/worker.pid','--exclude=.dots/desktop-*.png','--exclude=.dots/diagnostic.png','--exclude=.dots/desktop/*/runtime','--exclude=.dots/desktop/*/apps.log'];
const reader=spawn('wsl.exe',['-d',source,'-u','dot','--exec','tar','-cf','-',...exclude,'-C','/home/dot','.dots','Workspace'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const writer=spawn('wsl.exe',['-d',DISTRO,'-u','dot','--exec','sh','-c','mkdir -p /home/dot/.dots /home/dot/Workspace && tar --skip-old-files -xf - -C /home/dot && chmod 700 /home/dot/.dots'],{windowsHide:true,stdio:['pipe','inherit','pipe']});
reader.stdout.pipe(writer.stdin);reader.stderr.pipe(process.stderr);writer.stderr.pipe(process.stderr);
const [a,b]=await Promise.all([new Promise(r=>reader.once('exit',r)),new Promise(r=>writer.once('exit',r))]);
if(a!==0||b!==0)throw Error('State transfer failed '+a+'/'+b);
console.log('Dot computer identity, thread history and files copied. Browser profile was not copied.');
