import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {projectRoot,verifyRelease} from './release-files.mjs';

const files=await verifyRelease(),target=join(projectRoot,'.data/releases'),pkg=JSON.parse(await readFile(join(projectRoot,'package.json'),'utf8'));await mkdir(target,{recursive:true});
const table=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const crc32=bytes=>{let crc=0xffffffff;for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;};
const local=[],central=[],manifest=[];let offset=0;
for(const path of files){
 const bytes=await readFile(join(projectRoot,path)),name=Buffer.from(path),compressed=deflateRawSync(bytes),crc=crc32(bytes);
 const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(33,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(name.length,26);
 local.push(header,name,compressed);
 const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt16LE(8,10);record.writeUInt16LE(33,14);record.writeUInt32LE(crc,16);record.writeUInt32LE(compressed.length,20);record.writeUInt32LE(bytes.length,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE(offset,42);central.push(record,name);
 offset+=header.length+name.length+compressed.length;manifest.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
const end=Buffer.alloc(22),centralBytes=Buffer.concat(central);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(centralBytes.length,12);end.writeUInt32LE(offset,16);
const zip=Buffer.concat([...local,centralBytes,end]),name=pkg.name+'-'+(pkg.releaseTag||'v'+pkg.version)+'-source.zip',temporary=join(target,name+'.tmp');
await writeFile(temporary,zip);await rename(temporary,join(target,name));
await writeFile(join(target,'manifest.json'),JSON.stringify({version:pkg.version,archive:name,sha256:createHash('sha256').update(zip).digest('hex'),files:manifest},null,2)+'\n');
console.log('Source archive ready: '+join(target,name)+' ('+files.length+' files, '+Math.round(zip.length/1024)+' KiB).');
