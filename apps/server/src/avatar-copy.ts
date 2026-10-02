import type {Dot} from '@dots/contracts';
export function avatarFilePointers(dot:Pick<Dot,'avatarUrl'|'avatarManifest'>){
 const pointers=new Set<string>();
 const visit=(value:unknown)=>{
  if(typeof value==='string'&&/^file-service:\/\/file_[a-f0-9]+$/.test(value))pointers.add(value);
  else if(value&&typeof value==='object')Object.values(value).forEach(visit);
 };
 visit(dot.avatarUrl);visit(dot.avatarManifest);return [...pointers];
}
export function rewriteAvatarPointers<T>(value:T,pointers:Map<string,string>):T{
 if(typeof value==='string')return (pointers.get(value)||value) as T;
 if(Array.isArray(value))return value.map(v=>rewriteAvatarPointers(v,pointers)) as T;
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewriteAvatarPointers(v,pointers)])) as T;
 return value;
}
