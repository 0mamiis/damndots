import { realpath, mkdir, readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
export class WorkspaceFilesystem {
  constructor(readonly roots:string[]){}
  async permitted(path:string,write=false):Promise<string>{
    if(typeof path!=='string'||!path||path.includes('\0'))throw new Error('Invalid path');
    const absolute=resolve(path);let canonical:string;
    try{canonical=await realpath(absolute);}catch(e){if(!write)throw e;let parent=dirname(absolute);for(;;){try{const found=await realpath(parent);canonical=resolve(found,relative(parent,absolute));break;}catch{const next=dirname(parent);if(next===parent)throw new Error('No existing parent');parent=next;}}}
    for(const root of this.roots){const allowed=await realpath(root);const p=relative(allowed,canonical!);if(p===''||(!p.startsWith('..')&&!isAbsolute(p)))return canonical!;}
    throw new Error('Path is outside granted workspace roots');
  }
  async read(path:string){const p=await this.permitted(path);const s=await stat(p);if(!s.isFile()||s.size>32*1024*1024)throw new Error('File is unavailable or larger than 32 MiB');return {data:(await readFile(p)).toString('base64'),size:s.size};}
  async write(path:string,data:string){const p=await this.permitted(path,true),buffer=Buffer.from(data,'base64');if(buffer.length>32*1024*1024)throw new Error('File is too large');await mkdir(dirname(p),{recursive:true});await this.permitted(dirname(p));await writeFile(p,buffer);return {path:p,size:buffer.length};}
  async list(path:string){const p=await this.permitted(path);return {items:(await readdir(p,{withFileTypes:true})).map(d=>({name:d.name,directory:d.isDirectory(),symlink:d.isSymbolicLink()}))};}
}
