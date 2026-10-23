import {randomUUID} from 'node:crypto';
import type {Message,RecordStore} from '@dots/contracts';
import type {OrbitRuntime} from './runtime/index.js';
import {SecretVault,IntegrationError} from './integrations/security.js';

export interface TelegramConfig {enabled:boolean;botToken:string;ownerUserId:string;dotId:string|null;mirrorUserMessages:boolean;mirrorReplies:boolean;}
interface Stored {id:string;encryptedConfig:string;revision:string;}
interface State {id:string;offset:number;since:string;lastMessageAt?:string;lastDeliveryAt?:string;lastPollAt?:string;lastError:string|null;botUsername?:string;}
interface Delivery {id:string;revision:string;messageId:string;chunks:number;status:'pending'|'sending'|'sent'|'delivery_unknown';updatedAt:string;}
const defaults:TelegramConfig={enabled:false,botToken:'',ownerUserId:'',dotId:null,mirrorUserMessages:true,mirrorReplies:true};
export class TelegramService {
 private timer?:ReturnType<typeof setInterval>;private busy?:Promise<void>;private abort=new AbortController();
 constructor(private store:RecordStore,private runtime:OrbitRuntime,private vault:SecretVault,private fetcher:typeof fetch=fetch,private clock:()=>number=Date.now){}
 private now(){return new Date(this.clock()).toISOString();}
 private record(){return this.store.get<Stored>('telegram_settings','owner');}
 private config():TelegramConfig {const r=this.record();return r?{...defaults,...this.vault.open(r.encryptedConfig)}:defaults;}
 private state():State {return this.store.get<State>('telegram_state','owner')??{id:'owner',offset:0,since:this.now(),lastError:null};}
 private saveState(p:Partial<State>){return this.store.put('telegram_state',{...this.state(),...p,id:'owner'});}
 settings(){const {botToken,...c}=this.config(),s=this.state(),rev=this.record()?.revision;return {...c,hasBotToken:!!botToken,botUsername:s.botUsername??null,lastPollAt:s.lastPollAt??null,lastMessageAt:s.lastMessageAt??null,lastDeliveryAt:s.lastDeliveryAt??null,lastError:s.lastError,deliveryUnknown:this.store.list<Delivery>('telegram_deliveries',{where:{revision:rev??'',status:'delivery_unknown'}}).length};}
 update(p:Partial<TelegramConfig>){
  const old=this.config(),next={...old,...p};
  if(p.botToken==='')next.botToken=old.botToken;
  if(next.botToken&&!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(next.botToken))throw new IntegrationError('Invalid Telegram bot token');
  if(next.ownerUserId&&(!/^[1-9]\d{0,15}$/.test(next.ownerUserId)||!Number.isSafeInteger(Number(next.ownerUserId))))throw new IntegrationError('Enter your numeric Telegram user ID, not a username');
  if(next.dotId)this.runtime.getDot(next.dotId);
  if(next.enabled&&(!next.botToken||!next.ownerUserId||!next.dotId))throw new IntegrationError('Select a Dot and enter a bot token and owner user ID before enabling Telegram');
  this.abort.abort();this.abort=new AbortController();
  const prior=this.record();const changed=!prior||old.dotId!==next.dotId||old.ownerUserId!==next.ownerUserId||old.botToken!==next.botToken;
  this.store.put<Stored>('telegram_settings',{id:'owner',encryptedConfig:this.vault.seal(next),revision:changed?randomUUID():prior.revision});
  if(changed)this.store.put<State>('telegram_state',{id:'owner',offset:old.botToken===next.botToken?this.state().offset:0,since:this.now(),lastError:null});
  return this.settings();
 }
 disconnect(){this.abort.abort();this.abort=new AbortController();this.store.delete('telegram_settings','owner');this.store.delete('telegram_state','owner');return this.settings();}
 private current(revision:string){return this.record()?.revision===revision&&this.config().enabled;}
 private async call(c:TelegramConfig,method:string,body:unknown,signal=this.abort.signal):Promise<any>{
  let r:Response;
  try{r=await this.fetcher('https://api.telegram.org/bot'+c.botToken+'/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});}
  catch{throw new IntegrationError('Telegram could not be reached',502);}
  let result:any;try{result=await r.json();}catch{throw new IntegrationError('Invalid Telegram response',502);}
  if(!r.ok||result.ok!==true)throw new IntegrationError(r.status===409?'Telegram polling conflict: stop other bridges and remove any existing webhook':r.status===401?'Telegram bot token was rejected':r.status===429?'Telegram rate limit; delivery will retry':r.status===403?'Telegram delivery blocked: open your bot and press Start':'Telegram request failed (HTTP '+r.status+')',r.status===429?429:502);
  return result.result;
 }
 async test(){const c=this.config();if(!c.botToken)throw new IntegrationError('Save a bot token first');const me=await this.call(c,'getMe',{}),wh=await this.call(c,'getWebhookInfo',{});if(wh.url)throw new IntegrationError('This bot has a webhook configured. Remove it from its existing integration before enabling polling',409);this.saveState({botUsername:me.username,lastError:null});return {ok:true,botUsername:me.username};}
 async testMessage(){const c=this.config();if(!c.ownerUserId||!c.botToken)throw new IntegrationError('Save the bot token and owner user ID first');await this.call(c,'sendMessage',{chat_id:c.ownerUserId,text:'damndots Telegram connection test succeeded.'});return {ok:true};}
 start(){if(this.timer)return;this.timer=setInterval(()=>{if(!this.busy)this.busy=this.tick().catch(e=>{this.saveState({lastError:e instanceof IntegrationError?e.message:'Telegram synchronization failed'});}).finally(()=>{this.busy=undefined;});},1500);this.timer.unref();}
 async stop(){if(this.timer)clearInterval(this.timer);this.timer=undefined;this.abort.abort();await this.busy;}
 async tick(){
  const c=this.config(),rev=this.record()?.revision;if(!c.enabled||!rev)return;
  this.runtime.getDot(c.dotId!);
  // Delivery is handled independently from the origin of a task, so desktop and Telegram share one chat.
  await this.mirror(c,rev);if(!this.current(rev))return;
  const updates=await this.call(c,'getUpdates',{offset:this.state().offset,timeout:2,limit:20,allowed_updates:['message']});
  if(!this.current(rev))return;
  for(const u of updates){
   if(!Number.isSafeInteger(u.update_id)||u.update_id<this.state().offset)continue;
   const m=u.message;
   if(m?.chat?.type==='private'&&String(m.chat.id)===c.ownerUserId&&String(m.from?.id)===c.ownerUserId&&!m.from?.is_bot){
    const text=typeof m.text==='string'?m.text.trim():'';
    if(text==='/start'||text==='/help')await this.call(c,'sendMessage',{chat_id:c.ownerUserId,text:'Connected to damndots. Send text to chat with your Dot. /status checks the connection. Photos and voice messages are not supported yet.'});
    else if(text==='/status')await this.call(c,'sendMessage',{chat_id:c.ownerUserId,text:'damndots is connected to '+this.runtime.getDot(c.dotId!).name+'.'});
    else if(text)this.runtime.submitMessage(c.dotId!,{text,channel:'telegram',requestId:'telegram:'+rev+':'+u.update_id});
    else await this.call(c,'sendMessage',{chat_id:c.ownerUserId,text:'Please send a text message. Photos and voice messages are not supported yet.'});
    this.saveState({lastMessageAt:this.now()});
   }
   this.saveState({offset:u.update_id+1});
  }
  this.saveState({lastPollAt:this.now(),lastError:null});
 }
 private async mirror(c:TelegramConfig,rev:string){
  const state=this.state();
  const messages=this.runtime.listMessages(c.dotId!).filter(m=>m.createdAt>=state.since).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  for(const m of messages){
   if(!this.current(rev))return;
   const id=rev+':'+m.id;let d=this.store.get<Delivery>('telegram_deliveries',id);
   if(d?.status==='sent'||d?.status==='delivery_unknown')continue;
   if(d?.status==='sending'){this.store.put('telegram_deliveries',{...d,status:'delivery_unknown',updatedAt:this.now()});continue;}
   const should=(m.role==='assistant'&&c.mirrorReplies)||(m.role==='user'&&m.channel!=='telegram'&&c.mirrorUserMessages);
   if(!should){this.store.put<Delivery>('telegram_deliveries',{id,revision:rev,messageId:m.id,chunks:0,status:'sent',updatedAt:this.now()});continue;}
   let text=(m.role==='user'?'You (Codex):\n':this.runtime.getDot(c.dotId!).name+':\n')+m.text;
   if(m.attachments?.length)text+='\n[Attachments: '+m.attachments.map(a=>a.name).join(', ')+']';
   // Code point slicing avoids breaking emoji/surrogate pairs at Telegram's size limit.
   const chars=Array.from(text),chunks:string[]=[];for(let i=0;i<chars.length;i+=3000)chunks.push(chars.slice(i,i+3000).join(''));
   d=d??{id,revision:rev,messageId:m.id,chunks:0,status:'pending',updatedAt:this.now()};
   while(d.chunks<chunks.length){
    if(!this.current(rev))return;
    d={...d,status:'sending',updatedAt:this.now()};this.store.put('telegram_deliveries',d);
    try{await this.call(c,'sendMessage',{chat_id:c.ownerUserId,text:chunks[d.chunks]});}
    catch(e){if(e instanceof IntegrationError&&e.statusCode===429)this.store.put('telegram_deliveries',{...d,status:'pending',updatedAt:this.now()});else this.store.put('telegram_deliveries',{...d,status:'delivery_unknown',updatedAt:this.now()});throw e;}
    d={...d,chunks:d.chunks+1,status:'pending',updatedAt:this.now()};this.store.put('telegram_deliveries',d);
   }
   this.store.put('telegram_deliveries',{...d,status:'sent',updatedAt:this.now()});this.saveState({lastDeliveryAt:this.now(),since:m.createdAt});
  }
 }
}
