import {DISTRO} from './linux-computer/distro.mjs';
import fs from 'node:fs';import {execFileSync,spawn} from 'node:child_process';import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'..'),dir=join(root,'.data/linux-computer/ssh');fs.mkdirSync(dir,{recursive:true});const key=join(dir,'id_ed25519');
if(!fs.existsSync(key))execFileSync('ssh-keygen.exe',['-q','-t','ed25519','-N','','-f',key],{windowsHide:true,stdio:['ignore','pipe','pipe']});
const publicKey=fs.readFileSync(key+'.pub','utf8').trim();
const child=spawn('wsl.exe',['-d',DISTRO,'-u','root','--exec','sh','-c','install -d -m 700 -o dot -g dot /home/dot/.ssh; cat > /home/dot/.ssh/authorized_keys; chown dot:dot /home/dot/.ssh/authorized_keys; chmod 600 /home/dot/.ssh/authorized_keys; service ssh stop >/dev/null 2>&1 || true; mkdir -p /run/sshd; /usr/sbin/sshd; cat /etc/ssh/ssh_host_ed25519_key.pub'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
child.stdin.end('command="/bin/false",restrict,port-forwarding,permitlisten="127.0.0.1:19340" '+publicKey+'\n');let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>process.stderr.write(b));const code=await new Promise(r=>child.once('exit',r));if(code!==0)throw Error('Tunnel key setup failed');
const hostKey=output.trim().split('\n').find(s=>s.startsWith('ssh-ed25519 '));if(!hostKey)throw Error('Linux SSH host key not returned');
fs.writeFileSync(join(dir,'known_hosts'),'[127.0.0.1]:22444 '+hostKey.split(' ').slice(0,2).join(' ')+'\n');console.log('Private local-only SSH tunnel is configured.');
