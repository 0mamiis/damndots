import type {RecordStore,RunInput,Dot} from '@dots/contracts';
export interface CodexSender {dotId:string;name:string;threadId:string;}
/** Sender identity is taken from the actual executing Dot, never from model-controlled tool arguments. */
export function codexSender(store:RecordStore,input:RunInput):CodexSender {
 const dot=store.get<Dot>('dots',input.dot.id);
 if(!dot?.rootThreadId)throw new Error('Dot has no proven sender thread');
 return {dotId:dot.id,name:dot.name,threadId:dot.rootThreadId};
}
const escapeXml=(text:string)=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const unescapeXml=(text:string)=>text.replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
/** Same envelope as the installed Codex app's codex_app create_thread/send_message_to_thread tools. */
export function delegationMessage(message:string,sender:CodexSender):string {
 if(!sender.dotId||!sender.threadId)throw new Error('Dot sender identity is required');
 return ['<codex_delegation>','  <source_thread_id>'+escapeXml(sender.threadId)+'</source_thread_id>','  <input>'+escapeXml(message)+'</input>','</codex_delegation>'].join('\n');
}
export function delegationInput(message:string,sender:CodexSender,toolName:'create_thread'|'send_message_to_thread'){
 return {input:[],toolOutput:{name:toolName,namespace:'codex_app',output:delegationMessage(message,sender)}};
}
export function delegationText(message:string):string {
 const value=message.trim();
 if(!value.startsWith('<codex_delegation>')||!value.endsWith('</codex_delegation>'))return message;
 const text=/<input>\s*([\s\S]*?)\s*<\/input>/i.exec(value)?.[1];
 return text===undefined?message:unescapeXml(text);
}
