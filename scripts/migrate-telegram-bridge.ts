/** Run with both the legacy bridge and Dots server stopped. Never prints the bot token. */
import {readFileSync} from 'node:fs';import {resolve,join} from 'node:path';import {randomUUID} from 'node:crypto';
import {SqliteStore} from '../apps/server/src/storage.js';import {SecretVault} from '../apps/server/src/integrations/security.js';
const arg=(key:string)=>{const i=process.argv.indexOf(key);if(i<0||!process.argv[i+1])throw Error('Required: '+key);return resolve(process.argv[i+1]);};
const data=arg('--data-dir'),legacy=arg('--legacy-dir'),store=new SqliteStore(join(data,'dots.sqlite'));
try{
 if(store.get('telegram_settings','owner'))throw Error('Telegram is already configured in damndots; migration stopped');
 const old=JSON.parse(readFileSync(join(legacy,'state.json'),'utf8')),token=readFileSync(join(legacy,'bot.token'),'utf8').trim();
 if(!store.get('dots',old.dotId)||String(old.userId)!==String(old.chatId)||!Number.isSafeInteger(old.userId)||old.userId<1||!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token))throw Error('Invalid legacy configuration');
 const vault=new SecretVault(Buffer.from(readFileSync(join(data,'signing.key'),'utf8').trim(),'hex')),revision=randomUUID(),now=new Date().toISOString();
 const messages=store.list<any>('messages',{where:{dotId:old.dotId}}).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
 const seen=new Set<string>(old.mirroredIds??[]),earliest=messages[0]?.createdAt??now;
 store.transaction(()=>{
  store.put('telegram_settings',{id:'owner',revision,encryptedConfig:vault.seal({enabled:true,botToken:token,ownerUserId:String(old.userId),dotId:old.dotId,mirrorUserMessages:true,mirrorReplies:true})});
  store.put('telegram_state',{id:'owner',offset:old.offset??0,since:seen.size?earliest:now,lastError:null});
  for(const id of seen)store.put('telegram_deliveries',{id:revision+':'+id,revision,messageId:id,chunks:0,status:'sent',updatedAt:now});
  for(const [id,out] of Object.entries<any>(old.mirrorOutbox??{}))store.put('telegram_deliveries',{id:revision+':'+id,revision,messageId:id,chunks:0,status:out.state==='pending'&&!out.chunks?'pending':'delivery_unknown',updatedAt:now});
 });
 console.log('Telegram migrated to encrypted damndots settings. Preserved update offset and '+seen.size+' delivered message receipts.');
}finally{store.close();}
