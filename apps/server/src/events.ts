import { EventEmitter } from 'node:events';
import type { RecordStore, RuntimeEvent } from '@dots/contracts';
export class ExternalEvents extends EventEmitter {
  constructor(private store:RecordStore){super();}
  publish(type:string,data:Record<string,unknown>,dotId:string|null=null,taskId:string|null=null):RuntimeEvent{
    const event=this.store.transaction(()=>{const n=(this.store.get<{id:string;value:number}>('runtime_meta','event_sequence')?.value||0)+1;this.store.put('runtime_meta',{id:'event_sequence',value:n});return this.store.put<RuntimeEvent>('events',{id:String(n).padStart(16,'0'),type,dotId,taskId,data,createdAt:new Date().toISOString()});});
    this.emit('event',event);return event;
  }
}
