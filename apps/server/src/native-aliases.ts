import type {Dot,RecordStore} from '@dots/contracts';
export interface NativeAliasInput {dotId?:string;threadId?:string;roomId?:string;}
/** Explicit migration links only. Never guess a target by name or by the current selection. */
export function registerNativeAliases(store:RecordStore,target:Dot,input:NativeAliasInput){
 const entries=[['native_dot_aliases',input.dotId],['native_thread_aliases',input.threadId],['native_room_aliases',input.roomId]] as const;
 return store.transaction(()=>{
  for(const [namespace,id] of entries){
   if(!id)continue;
   const conflict=store.get<{dotId:string}>(namespace,id);
   const dot=store.list<Dot>('dots').find(d=>namespace==='native_dot_aliases'?d.id===id:namespace==='native_room_aliases'?d.messagingRoomId===id:d.rootThreadId===id);
   const taskOwner=namespace==='native_thread_aliases'?store.list<{dotId:string;threadId:string}>('tasks').find(t=>t.threadId===id):undefined;
   if((conflict&&conflict.dotId!==target.id)||(dot&&dot.id!==target.id)||(taskOwner&&taskOwner.dotId!==target.id))
    throw Object.assign(new Error('Native alias belongs to another Dot'),{statusCode:409});
  }
  for(const [namespace,id] of entries)if(id)store.put(namespace,{id,dotId:target.id});
  return {ok:true,dotId:target.id};
 });
}
export function resolveNativeAlias(store:RecordStore,namespace:'native_dot_aliases'|'native_room_aliases',id:string){
 const alias=store.get<{dotId:string}>(namespace,id);
 return alias&&store.get<Dot>('dots',alias.dotId);
}
