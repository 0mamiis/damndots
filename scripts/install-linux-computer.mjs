import {createHash} from 'node:crypto';
import {createWriteStream,createReadStream,existsSync} from 'node:fs';
import {mkdir,writeFile,stat} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {spawn,execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),data=join(root,'.data','linux-computer');
await mkdir(data,{recursive:true});
const distro='Dots-Computer';
const decoded=b=>b.includes(0)?b.toString('utf16le'):b.toString('utf8');
let listed='';try{listed=decoded(execFileSync('wsl.exe',['--list','--quiet'],{windowsHide:true}));}catch{}
if(listed.split(/\r?\n/).some(x=>x.trim()===distro)){console.log('Dots-Computer already installed.');process.exit(0);}
const manifest=await(await fetch('https://raw.githubusercontent.com/microsoft/WSL/master/distributions/DistributionInfo.json')).json();
const entry=manifest.ModernDistributions?.Ubuntu?.find(x=>x.Name==='Ubuntu-24.04');if(!entry?.Amd64Url?.Url||!entry.Amd64Url.Sha256)throw Error('Official Ubuntu 24.04 manifest unavailable');
const image=join(data,'ubuntu-24.04.wsl'),metadata=join(data,'image.json');
const checksum=async path=>{const hash=createHash('sha256');for await(const b of createReadStream(path))hash.update(b);return hash.digest('hex');};
if(!existsSync(image)||await checksum(image)!==entry.Amd64Url.Sha256){
 console.log('Downloading official Ubuntu 24.04 WSL image.');
 const response=await fetch(entry.Amd64Url.Url);if(!response.ok||!response.body)throw Error('Image download HTTP '+response.status);
 const total=Number(response.headers.get('content-length')||0);let count=0,last=0;
 const input=Readable.fromWeb(response.body);input.on('data',chunk=>{count+=chunk.length;if(Date.now()-last>10000){last=Date.now();console.log('Downloaded '+Math.round(count/1024/1024)+' MiB'+(total?' / '+Math.round(total/1024/1024)+' MiB':''));}});
 await pipeline(input,createWriteStream(image));
 if(await checksum(image)!==entry.Amd64Url.Sha256)throw Error('Ubuntu image checksum mismatch');
 await writeFile(metadata,JSON.stringify({url:entry.Amd64Url.Url,sha256:entry.Amd64Url.Sha256,size:(await stat(image)).size},null,2));
}
console.log('Verified image; importing dedicated Dots-Computer distribution.');
const directory=join(data,'distro');await mkdir(directory,{recursive:true});
const child=spawn('wsl.exe',['--import',distro,directory,image,'--version','2'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let out=[],err=[];child.stdout.on('data',b=>out.push(b));child.stderr.on('data',b=>err.push(b));
const code=await new Promise(r=>child.once('exit',r));console.log(decoded(Buffer.concat(out)));if(code!==0)throw Error('WSL import failed: '+decoded(Buffer.concat(err)));
console.log('Ubuntu is installed as '+distro);console.log(decoded(execFileSync('wsl.exe',['-d',distro,'-u','root','--exec','uname','-sr'],{windowsHide:true})));
