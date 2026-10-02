import {createHash} from 'node:crypto';import {createWriteStream,existsSync,createReadStream} from 'node:fs';import {mkdir,writeFile} from 'node:fs/promises';import {Readable} from 'node:stream';import {pipeline} from 'node:stream/promises';import {spawn,execFileSync} from 'node:child_process';import {join,resolve} from 'node:path';
import {DISTRO} from './linux-computer/distro.mjs';
/** Imports the official Debian 13 (trixie) container root filesystem; its layer digest is verified against the published OCI manifest. */
const root=resolve(import.meta.dirname,'..'),data=join(root,'.data/linux-computer/debian'),raw='https://raw.githubusercontent.com/debuerreotype/docker-debian-artifacts/dist-amd64/trixie/oci/blobs/';
await mkdir(data,{recursive:true});
const decoded=b=>b.includes(0)?b.toString('utf16le'):b.toString('utf8');
let listed='';try{listed=decoded(execFileSync('wsl.exe',['--list','--quiet'],{windowsHide:true}));}catch{}
if(process.env.DOTS_LINUX_IMAGE){
 if(listed.split(/\r?\n/).some(x=>x.trim()===DISTRO))throw Error('Custom image import refuses to overwrite an existing WSL distribution.');
 const image=resolve(process.env.DOTS_LINUX_IMAGE),expected=process.env.DOTS_LINUX_IMAGE_SHA256||'';if(!/^[a-f0-9]{64}$/i.test(expected)||!/\.(tar|tar\.gz|tgz|wsl)$/i.test(image))throw Error('Custom WSL rootfs requires SHA256 and tar/wsl format.');
 const h=createHash('sha256');for await(const b of createReadStream(image))h.update(b);if(h.digest('hex').toLowerCase()!==expected.toLowerCase())throw Error('Custom image SHA256 mismatch. No distribution imported.');
 const directory=join(root,'.data/linux-computer/custom',DISTRO);await mkdir(directory,{recursive:true});execFileSync('wsl.exe',['--import',DISTRO,directory,image,'--version','2'],{windowsHide:true,stdio:'inherit'});
 const release=decoded(execFileSync('wsl.exe',['-d',DISTRO,'-u','root','--exec','cat','/etc/os-release'],{windowsHide:true}));if(!/^ID=debian\s*$/m.test(release)||!/^VERSION_ID="?13"?\s*$/m.test(release))throw Error('Imported rootfs must be Debian 13 for this desktop installer. Imported distribution is preserved; it was not configured.');
 await writeFile(join(data,'image.json'),JSON.stringify({custom:true,distribution:DISTRO,sha256:expected},null,2));console.log(DISTRO+' custom Debian rootfs verified and imported.');process.exit(0);
}
if(listed.split(/\r?\n/).some(x=>x.trim()===DISTRO)){
 try{execFileSync('wsl.exe',['-d',DISTRO,'-u','root','--exec','test','-f','/home/dot/.dots/installed'],{windowsHide:true,stdio:'ignore'});}
 catch{if(!existsSync(join(data,'image.json')))throw Error('A WSL distribution named '+DISTRO+' already exists and is not identified as this installation. Set DOTS_LINUX_DISTRO to a new unique name; the existing distribution was not changed.');}
 console.log(DISTRO+' already installed.');process.exit(0);
}
const manifest=await(await fetch(raw+'image-manifest.json')).json(),layer=manifest.layers?.[0];if(!layer?.digest?.startsWith('sha256:'))throw Error('Official Debian manifest unavailable');
const archive=join(data,'rootfs.tar.gz'),digest=layer.digest.slice(7);
const checksum=async()=>{const h=createHash('sha256');for await(const b of createReadStream(archive))h.update(b);return h.digest('hex');};
if(!existsSync(archive)||await checksum()!==digest){const r=await fetch(raw+'rootfs.tar.gz');if(!r.ok||!r.body)throw Error('Debian download HTTP '+r.status);await pipeline(Readable.fromWeb(r.body),createWriteStream(archive));}
if(await checksum()!==digest)throw Error('Debian root filesystem digest mismatch');
const directory=join(data,'distro');await mkdir(directory,{recursive:true});
const child=spawn('wsl.exe',['--import',DISTRO,directory,archive,'--version','2'],{windowsHide:true,stdio:'inherit'});
const code=await new Promise(r=>child.once('exit',r));if(code!==0)throw Error('WSL import failed '+code);
await writeFile(join(data,'image.json'),JSON.stringify({source:raw+'rootfs.tar.gz',sha256:digest,debian:'13'},null,2));console.log(DISTRO+' imported.');
