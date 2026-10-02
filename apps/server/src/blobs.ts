import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, stat, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import type { Attachment, RecordStore } from '@dots/contracts';
export class BlobStore {
  constructor(readonly directory:string,private store:RecordStore){}
  async put(bytes:Buffer,name:string,mimeType:string,dotId:string|null=null):Promise<Attachment>{
    if(bytes.length>32*1024*1024)throw new Error('Upload exceeds 32 MiB');await mkdir(this.directory,{recursive:true});const id='file_'+randomUUID().replaceAll('-',''),path=join(this.directory,id);
    await writeFile(path,bytes,{mode:0o600});const a={id,name,mimeType,size:bytes.length,path};this.store.put('blobs',{...a,dotId});return a;
  }
  get(id:string):Attachment {const b=this.store.get<Attachment>('blobs',id);if(!b)throw Object.assign(new Error('File not found'),{statusCode:404});return b;}
  forDot(id:string,dotId:string):Attachment {const a=this.store.get<Attachment&{dotId:string|null}>('blobs',id);if(!a||a.dotId!==dotId)throw Object.assign(new Error('Attachment does not belong to this dot'),{statusCode:403});return {id:a.id,name:a.name,mimeType:a.mimeType,size:a.size,path:a.path};}
  async read(id:string):Promise<Buffer>{const a=this.get(id),r=await realpath(this.directory),p=await realpath(a.path!);const rel=relative(r,p);if(rel.startsWith('..')||isAbsolute(rel))throw new Error('Invalid blob path');if((await stat(p)).size>32*1024*1024)throw new Error('File is too large');return readFile(p);}
}
