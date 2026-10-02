import {DISTRO} from './linux-computer/distro.mjs';
import fs from 'node:fs';import {mkdir,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';import {Readable} from 'node:stream';import {pipeline} from 'node:stream/promises';import {execFileSync,spawn} from 'node:child_process';
const root=resolve(import.meta.dirname,'..'),dir=join(root,'.data/linux-computer/packages');await mkdir(dir,{recursive:true});
const installed=path=>{try{execFileSync('wsl.exe',['-d',DISTRO,'-u','root','--exec','test','-x',path],{windowsHide:true,stdio:'ignore'});return true;}catch{return false;}};
async function download(url,name,algorithm,digest){
 const file=join(dir,name),hash=async()=>{const h=createHash(algorithm);for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');};
 if(fs.existsSync(file)&&await hash()!==digest)fs.unlinkSync(file);
 if(!fs.existsSync(file)){const r=await fetch(url);if(!r.ok||!r.body)throw Error(name+' download HTTP '+r.status);let bytes=0,last=0;const stream=Readable.fromWeb(r.body);stream.on('data',b=>{bytes+=b.length;if(Date.now()-last>10000){last=Date.now();console.log(name,Math.round(bytes/1048576)+' MiB');}});await pipeline(stream,fs.createWriteStream(file));}
 if(await hash()!==digest)throw Error(name+' official checksum mismatch');await writeFile(join(dir,name+'.json'),JSON.stringify({url,algorithm,digest},null,2));return file;
}
async function install(file,command){const p=spawn('wsl.exe',['-d',DISTRO,'-u','root','--exec','sh','-c',command],{windowsHide:true,stdio:['pipe','pipe','pipe']});fs.createReadStream(file).pipe(p.stdin);p.stdout.pipe(process.stdout);p.stderr.pipe(process.stderr);const code=await new Promise(r=>p.once('exit',r));if(code!==0)throw Error('App install failed '+code);}
if(!installed('/opt/freecad/AppRun')&&!installed('/usr/bin/freecad')){
 const response=await fetch('https://api.github.com/repos/FreeCAD/FreeCAD/releases/latest');if(!response.ok)throw Error('Official FreeCAD release unavailable');const release=await response.json(),asset=release.assets.find(a=>/Linux-x86_64.*\.AppImage$/.test(a.name)),checksum=asset&&release.assets.find(a=>a.name===asset.name+'-SHA256.txt');if(!asset||!checksum)throw Error('Official FreeCAD Linux image/checksum missing');
 const digest=(await(await fetch(checksum.browser_download_url)).text()).match(/[a-f0-9]{64}/i)?.[0];if(!digest)throw Error('FreeCAD SHA256 unavailable');const file=await download(asset.browser_download_url,'freecad.AppImage','sha256',digest);
 await install(file,'cat >/tmp/dots-freecad.AppImage && chmod +x /tmp/dots-freecad.AppImage && mkdir -p /opt/dots-freecad-extract && cd /opt/dots-freecad-extract && /tmp/dots-freecad.AppImage --appimage-extract >/dev/null && mv squashfs-root /opt/freecad && find /opt/freecad/usr/share/icons -name "*freecad*.svg" -print -quit | xargs -r -I{} cp {} /usr/share/pixmaps/freecad.svg && echo "FreeCAD installed"');
}
const pinned=join(root,'scripts/linux-computer/apps.json');
if(!installed('/opt/slicer/Slicer')&&fs.existsSync(pinned)){
 const known=JSON.parse(fs.readFileSync(pinned,'utf8')).slicer;
 const file=await download(known.url,'slicer.tar.gz','sha512',known.sha512);
 await install(file,'mkdir -p /opt/slicer && tar -xzf - -C /opt/slicer --strip-components=1 && cp /opt/slicer/Slicer.png /usr/share/pixmaps/slicer.png && echo 3D Slicer installed');
}
if(!installed('/opt/slicer/Slicer')){
 const html=await(await fetch('https://download.slicer.org/')).text(),digest=html.match(/<td[^>]*>\s*(?:<code>)?Linux(?:<\/code>)?\s*<\/td>\s*<td[^>]*>\s*(?:<code>)?([a-f0-9]{128})/i)?.[1];if(!digest)throw Error('Official Slicer Linux checksum unavailable');
 let url;for(const href of [...new Set([...html.matchAll(/href=["'](\/bitstream\/[^"']+)["']/g)].map(m=>m[1]))]){const r=await fetch('https://download.slicer.org'+href,{method:'HEAD'});if(r.ok&&/linux.*\.tar\.gz/i.test(r.headers.get('content-disposition')||'')){url='https://download.slicer.org'+href;break;}}
 if(!url)throw Error('Official Slicer Linux archive unavailable');const file=await download(url,'slicer.tar.gz','sha512',digest);await install(file,'mkdir -p /opt/slicer && tar -xzf - -C /opt/slicer --strip-components=1 && cp /opt/slicer/Slicer.png /usr/share/pixmaps/slicer.png && echo "3D Slicer installed"');
}
console.log('Extra Linux applications are installed.');
