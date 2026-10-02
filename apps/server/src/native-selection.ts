import type {Dot,RecordStore} from '@dots/contracts';

export interface NativePrimary {id:'primary';dotId:string;generation:number;selectedAt?:string;}
export const visibleNativeDots=(store:RecordStore,dots:Dot[])=>dots.filter(d=>!store.get('native_hidden_dots',d.id));

export function setNativePrimary(store:RecordStore,dot:Dot):NativePrimary {
 const previous=store.get<NativePrimary>('native_meta','primary');
 return store.put('native_meta',{id:'primary',dotId:dot.id,generation:Math.max(Date.now(),(previous?.generation??0)+1),selectedAt:new Date().toISOString()});
}

/** Selection is persistent. Task updates and root repair must not pick a different Dot. */
export function selectNativePrimary(store:RecordStore,dots:Dot[]):Dot|undefined {
 const visible=visibleNativeDots(store,dots),saved=store.get<NativePrimary>('native_meta','primary');
 const selected=saved&&visible.find(d=>d.id===saved.dotId);
 if(selected)return selected; // rootThreadId may need repair; identity is still valid
 // A deleted legacy selection may leave acceptance fixtures behind. Prefer a
 // customized user profile, then the latest creation; never use mutable update order.
 const next=[...visible].sort((a,b)=>Number(!!(b.avatarManifest||b.avatarUrl))-Number(!!(a.avatarManifest||a.avatarUrl))||b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id))[0];
 if(next)setNativePrimary(store,next);
 else if(saved)store.delete('native_meta','primary');
 return next;
}
