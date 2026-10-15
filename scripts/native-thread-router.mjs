import {readFileSync,writeFileSync,renameSync} from 'node:fs';

/** Only backend-proven Dot threads go to Dots; normal desktop chats stay local.
 * Keep historical ids across root migrations. A cached UI may reopen an older root after the Dot has moved on.
 * With persistFile, proven ids survive restarts: the desktop reopens the Dot thread right after launch, often before the
 * Dots gateway can answer, and an unproven id would be sent to the local CLI ("thread not found").
 */
export class NativeThreadRegistry {
 constructor(get,{refreshMs=5000,negativeMs=5000,clock=Date.now,persistFile}={}){
  this.get=get;this.refreshMs=refreshMs;this.negativeMs=negativeMs;this.clock=clock;
  this.threads=new Set();this.negative=new Map();this.pending=new Map();this.refreshed=null;this.refreshing=null;
  this.persistFile=persistFile;this.persisted=0;
  if(persistFile){try{const saved=JSON.parse(readFileSync(persistFile,'utf8'));if(Array.isArray(saved))for(const id of saved)if(typeof id==='string'&&id)this.threads.add(id);this.persisted=this.threads.size;}catch{}}
 }
 has(id){return this.threads.has(id);}
 persist(){
  if(!this.persistFile||this.threads.size===this.persisted)return;
  try{const temp=this.persistFile+'.tmp';writeFileSync(temp,JSON.stringify([...this.threads]));renameSync(temp,this.persistFile);this.persisted=this.threads.size;}catch{}
 }
 async refresh(){
  if(this.refreshed!==null&&this.clock()-this.refreshed<this.refreshMs)return;
  if(this.refreshing)return this.refreshing;
  this.refreshing=(async()=>{
   const data=await this.get('/backend-api/tbo');
   for(const dot of data.items||[]){
    if(dot.root_thread_id)this.threads.add(dot.root_thread_id);
    if(dot.active_root_thread_id)this.threads.add(dot.active_root_thread_id);
    if(typeof dot.id!=='string'||!dot.id)continue;
    // Each history request is independent: keep proven roots even if one history cannot be read.
    try{
     const history=await this.get('/backend-api/tbo/'+encodeURIComponent(dot.id)+'/threads');
     for(const item of history.items||[])if(typeof item.thread_id==='string'&&item.thread_id)this.threads.add(item.thread_id);
    }catch{}
   }
   this.refreshed=this.clock();
   this.persist();
  })().finally(()=>{this.refreshing=null;});
  return this.refreshing;
 }
 async owns(id){
  if(this.threads.has(id))return true;
  await this.refresh();
  if(this.threads.has(id))return true;
  if((this.negative.get(id)||0)>this.clock())return false;
  if(this.pending.has(id))return this.pending.get(id);
  const pending=(async()=>{
   try{
    // This endpoint resolves only explicit persisted task/alias/root ownership; it never guesses by name.
    const dot=await this.get('/backend-api/tbo/by-thread/'+encodeURIComponent(id));
    if(typeof dot?.id!=='string'||!dot.id)throw new Error('Invalid Dot ownership response');
    this.threads.add(id);this.negative.delete(id);
    if(dot.root_thread_id)this.threads.add(dot.root_thread_id);
    if(dot.active_root_thread_id)this.threads.add(dot.active_root_thread_id);
    this.persist();
    return true;
   }catch(error){
    if(error.statusCode!==404)throw error;
    if(this.negative.size>=500)this.negative.clear();
    this.negative.set(id,this.clock()+this.negativeMs);return false;
   }
  })().finally(()=>this.pending.delete(id));
  this.pending.set(id,pending);return pending;
 }
}

