import { readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Dot, Message, RecordStore } from '@dots/contracts';
import type { BlobStore } from './blobs.js';
export async function importLegacy(directory:string,store:RecordStore,blobs:BlobStore):Promise<{dots:number;messages:number;avatars:number;alreadyImported:boolean}>{
  const root=resolve(directory),key=createHash('sha256').update(root).digest('hex');if(store.get('legacy_imports',key))return {dots:0,messages:0,avatars:0,alreadyImported:true};
  const data=JSON.parse(await readFile(join(root,'data/orbit-store.json'),'utf8'));
  if(!Array.isArray(data.tbos))throw new Error('Invalid legacy dot store');
  const messages=JSON.parse(await readFile(join(root,'data/messages.json'),'utf8'));let dots=0,count=0,avatars=0;
  const imported:Dot[]=[],msgs:Message[]=[];
  for(const old of data.tbos){if(store.get('dots',old.id))continue;
    let avatarUrl=old.avatar_url||old.avatar_manifest?.snapshot?.asset_pointer||null,manifest=old.avatar_manifest||null;
    if(avatarUrl?.startsWith('file-service://')){const id=avatarUrl.slice(15);if(!/^[A-Za-z0-9_-]+$/.test(id))throw new Error('Invalid avatar pointer');try{const bytes=await readFile(join(root,'data/avatars',id+'.png')),a=await blobs.put(bytes,'avatar.png','image/png',old.id);avatarUrl='file-service://'+a.id;if(manifest?.snapshot)manifest={...manifest,snapshot:{...manifest.snapshot,asset_pointer:avatarUrl}};avatars++;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
    const dot:Dot={id:old.id,name:old.display_name||old.name||'dot',paused:!!old.is_paused,rootThreadId:old.root_thread_id||null,messagingRoomId:old.messaging_room_id,model:null,reasoningEffort:'high',serviceTier:null,computerId:null,instructions:old.instructions||'',avatarUrl,avatarManifest:manifest,createdAt:old.created_at||new Date().toISOString(),updatedAt:old.updated_at||new Date().toISOString()};imported.push(dot);dots++;
    for(const m of messages[old.messaging_room_id]||[]){const raw=m.raw_messages?.[0];const role=raw?.author?.role==='assistant'?'assistant':raw?.author?.role==='system'?'system':'user';const text=raw?raw.content?.parts?.filter((p:any)=>typeof p==='string').join('\n')||'':m.content?.text||'';msgs.push({id:m.id,dotId:dot.id,role,text,attachments:[],taskId:null,channel:'chatgpt',requestId:m.request_id||null,createdAt:m.created_at||new Date().toISOString()});count++;}
    for(const threadId of old.thread_ids||[])store.put('native_thread_aliases',{id:threadId,dotId:dot.id});
  }
  store.transaction(()=>{for(const d of imported)store.put('dots',d);for(const m of msgs)store.put('messages',m);if(data.primaryTboId&&imported.some(d=>d.id===data.primaryTboId))store.put('native_meta',{id:'primary',dotId:data.primaryTboId,generation:data.primaryGeneration||1});store.put('legacy_imports',{id:key,path:root,createdAt:new Date().toISOString(),dots,messages:count,avatars});});
  return {dots,messages:count,avatars,alreadyImported:false};
}
