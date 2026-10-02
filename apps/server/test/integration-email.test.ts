import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createNetServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { SMTPServer } from 'smtp-server';
import { IntegrationService } from '../src/integrations/index.js';
import type { RecordStore } from '@dots/contracts';

class MemoryStore implements RecordStore {
  rows=new Map<string,any>();get<T>(ns:string,id:string):T|undefined{return structuredClone(this.rows.get(`${ns}:${id}`));}
  list<T>(ns:string):T[]{return [...this.rows].filter(([key])=>key.startsWith(`${ns}:`)).map(([,v])=>structuredClone(v));}
  put<T extends {id:string}>(ns:string,value:T):T{this.rows.set(`${ns}:${value.id}`,structuredClone(value));return value;}
  delete(ns:string,id:string):boolean{return this.rows.delete(`${ns}:${id}`);}
  transaction<T>(fn:()=>T):T{return fn();}
}
async function imapServer() {
  const auth:string[]=[],commands:string[]=[],sockets=new Set<any>();let reject=false,validity='1';
  const mails=[Buffer.from('From: Allowed <allowed@example.test>\r\nTo: dot@example.test\r\nSubject: Controlled mailbox\r\nMessage-ID: <local-1@example.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nLocal IMAP message body\r\n'),Buffer.from('From: Other <allowed@example.test.attacker>\r\nSubject: Ignore sender\r\n\r\nShould be ignored\r\n')];
  const server=createNetServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.write('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN AUTH=XOAUTH2 SASL-IR] Controlled IMAP\r\n');let pending='',authTag:string|undefined;
    socket.on('data',data=>{
      pending+=data.toString();let eol;
      while((eol=pending.indexOf('\r\n'))>=0){const line=pending.slice(0,eol);pending=pending.slice(eol+2);
        if(authTag){auth.push(Buffer.from(line,'base64').toString());socket.write(`${authTag} ${reject?'NO':'OK'} authenticated\r\n`);authTag=undefined;continue;}
        const [tag,...parts]=line.split(' '),cmd=parts.join(' ');commands.push(cmd);
        const ok=()=>socket.write(`${tag} OK complete\r\n`);
        if(/^CAPABILITY/i.test(cmd)){socket.write('* CAPABILITY IMAP4rev1 AUTH=PLAIN AUTH=XOAUTH2 SASL-IR\r\n');ok();}
        else if(/^AUTHENTICATE/i.test(cmd)){const initial=parts[2];if(initial){auth.push(Buffer.from(initial,'base64').toString());socket.write(`${tag} ${reject?'NO':'OK'} authenticated\r\n`);}else{authTag=tag;socket.write('+ \r\n');}}
        else if(/^LOGIN/i.test(cmd)){auth.push(cmd);socket.write(`${tag} ${reject?'NO':'OK'} authenticated\r\n`);}
        else if(/^LIST/i.test(cmd)){socket.write('* LIST (\\HasNoChildren) "/" "INBOX"\r\n');ok();}
        else if(/^LSUB/i.test(cmd)){socket.write('* LSUB (\\HasNoChildren) "/" "INBOX"\r\n');ok();}
        else if(/^(SELECT|EXAMINE)/i.test(cmd)){socket.write(`* FLAGS (\\Seen)\r\n* ${mails.length} EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY ${validity}] stable\r\n* OK [UIDNEXT 3] next\r\n${tag} OK [READ-WRITE] selected\r\n`);}
        else if(/^UID SEARCH/i.test(cmd)){const start=Number(cmd.match(/UID (\d+):\*/i)?.[1]??1);socket.write(`* SEARCH${[1,2].filter(uid=>uid>=start).map(uid=>` ${uid}`).join('')}\r\n`);ok();}
        else if(/^UID FETCH/i.test(cmd)){const uid=Number(parts[2]);const mail=mails[uid-1];if(mail)socket.write(Buffer.concat([Buffer.from(`* ${uid} FETCH (UID ${uid} BODY[] {${mail.length}}\r\n`),mail,Buffer.from(')\r\n')]));ok();}
        else if(/^LOGOUT/i.test(cmd)){socket.write(`* BYE controlled logout\r\n${tag} OK logout\r\n`);socket.end();}
        else if(/^(NOOP|CLOSE|UNSELECT|ID|ENABLE)/i.test(cmd))ok();
        else socket.write(`${tag} BAD unsupported ${cmd}\r\n`);
      }
    });
  });await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {port:(server.address() as any).port,auth,commands,setReject:(value:boolean)=>{reject=value;},setValidity:(value:string)=>{validity=value;},close:()=>new Promise<void>(resolve=>{for(const socket of sockets)socket.destroy();server.close(()=>resolve());})};
}
test('SMTP and IMAP verify actual local protocol credentials; email polling routes allowed senders once',async()=>{
  const imap=await imapServer();const smtpMessages:Buffer[]=[];const smtpAuth:any[]=[];
  const smtp=new SMTPServer({secure:false,disabledCommands:['STARTTLS'],authMethods:['PLAIN','LOGIN','XOAUTH2'],onAuth(auth,_session,callback){smtpAuth.push(auth);if(auth.username!=='dot@example.test')return callback(new Error('bad user'));callback(null,{user:auth.username});},onData(stream,_session,callback){const chunks:Buffer[]=[];stream.on('data',chunk=>chunks.push(Buffer.from(chunk)));stream.on('end',()=>{smtpMessages.push(Buffer.concat(chunks));callback();});}});
  await new Promise<void>(resolve=>smtp.listen(0,'127.0.0.1',resolve));const smtpPort=(smtp.server.address() as any).port;
  const received:any[]=[];const store=new MemoryStore();const api=new IntegrationService(store,{encryptionKey:randomBytes(32),inbound:async(...args)=>{received.push(args);return {task:{id:`email-task-${received.length}`}};},authorizeSend:async()=>true});
  try{
    const c=api.create({kind:'email',name:'Email',config:{dotId:'dot',allowedSenders:['allowed@example.test'],smtp:{host:'127.0.0.1',port:smtpPort,secure:false,user:'dot@example.test',password:'smtp-secret'},imap:{host:'127.0.0.1',port:imap.port,secure:false,user:'dot@example.test',password:'imap-secret'}},scopes:['mail:read','mail:send']});
    assert.equal((await api.test(c.id)).state,'connected');assert(imap.auth.some(v=>v.includes('imap-secret')));assert(smtpAuth.some(v=>v.password==='smtp-secret'));
    const mail:any=await api.call(c.id,'read_messages',{});assert.equal(mail.length,2);assert.equal(mail[0].text.trim(),'Local IMAP message body');
    assert.deepEqual(await api.pollEmail(c.id),{received:1});assert.equal(received.length,1);assert(received[0][1].includes('Local IMAP message body'));assert.deepEqual(await api.pollEmail(c.id),{received:0});
    const sent:any=await api.call(c.id,'send_message',{to:'local-recipient@example.test',subject:'Controlled SMTP',text:'Actual protocol bytes to local SMTP only'});assert(sent.accepted.includes('local-recipient@example.test'));assert.equal(smtpMessages.length,1);assert(smtpMessages[0].includes(Buffer.from('Actual protocol bytes')));
    const reply=await api.enqueueReply('email-task-1','Bound SMTP reply');assert.equal(reply?.status,'approval_required');assert.equal((await api.deliverReply(reply!.id)).status,'sent');assert.equal(smtpMessages.length,2);assert(smtpMessages[1].includes(Buffer.from('In-Reply-To: <local-1@example.test>')));assert(smtpMessages[1].includes(Buffer.from('To: allowed@example.test')));await api.deliverReply(reply!.id);assert.equal(smtpMessages.length,2);
    imap.setValidity('2');assert.deepEqual(await api.pollEmail(c.id),{received:1});assert.equal(received.length,2);
    imap.setReject(true);assert.equal((await api.test(c.id)).state,'error');
  }finally{await imap.close();await new Promise<void>(resolve=>smtp.close(()=>resolve()));}
});
test('Email OAuth uses actual XOAUTH2 with configured tokens against local providers',async()=>{
  const imap=await imapServer(),auths:any[]=[];
  const smtp=new SMTPServer({secure:false,disabledCommands:['STARTTLS'],authMethods:['XOAUTH2'],onAuth(auth,_session,callback){auths.push(auth);callback(null,{user:auth.username});}});await new Promise<void>(resolve=>smtp.listen(0,'127.0.0.1',resolve));
  try{const api=new IntegrationService(new MemoryStore(),{encryptionKey:randomBytes(32),inbound:async()=>{}});const c=api.create({kind:'email',name:'OAuth',config:{smtp:{host:'127.0.0.1',port:(smtp.server.address() as any).port,secure:false,user:'dot@example.test',accessToken:'smtp-access'},imap:{host:'127.0.0.1',port:imap.port,secure:false,user:'dot@example.test',accessToken:'imap-access'}},scopes:['mail:read']});assert.equal((await api.test(c.id)).state,'connected');assert(auths.some(a=>a.method==='XOAUTH2'&&a.accessToken==='smtp-access'));assert(imap.auth.some(a=>a.includes('Bearer imap-access')));}finally{await imap.close();await new Promise<void>(resolve=>smtp.close(()=>resolve()));}
});
test('Email refresh-token OAuth performs HTTP exchange and persists rotated token encrypted',async()=>{
  const imap=await imapServer();const refreshRequests:URLSearchParams[]=[];
  const oauth=createHttpServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=new URLSearchParams(Buffer.concat(chunks).toString());refreshRequests.push(body);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({access_token:'renewed-access',refresh_token:`rotated-${refreshRequests.length}`}));});await new Promise<void>(resolve=>oauth.listen(0,'127.0.0.1',resolve));
  const smtp=new SMTPServer({secure:false,disabledCommands:['STARTTLS'],authMethods:['XOAUTH2'],onAuth(auth,_session,callback){callback(null,{user:auth.username});}});await new Promise<void>(resolve=>smtp.listen(0,'127.0.0.1',resolve));
  try{const store=new MemoryStore();const api=new IntegrationService(store,{encryptionKey:randomBytes(32),inbound:async()=>{}});const c=api.create({kind:'email',name:'Refresh',config:{smtp:{host:'127.0.0.1',port:(smtp.server.address() as any).port,secure:false,user:'dot@example.test',accessToken:'smtp-access'},imap:{host:'127.0.0.1',port:imap.port,secure:false,user:'dot@example.test',oauth:{tokenUrl:`http://127.0.0.1:${(oauth.address() as any).port}/token`,clientId:'client',clientSecret:'client-secret',refreshToken:'original-refresh'}}},scopes:['mail:read']});assert.equal((await api.test(c.id)).state,'connected');assert.equal((await api.test(c.id)).state,'connected');assert.equal(refreshRequests[0].get('refresh_token'),'original-refresh');assert.equal(refreshRequests[1].get('refresh_token'),'rotated-1');assert.equal(refreshRequests[0].get('grant_type'),'refresh_token');assert(imap.auth.some(a=>a.includes('Bearer renewed-access')));assert(!JSON.stringify([...store.rows]).includes('rotated-2'));assert.equal(((api.get(c.id).config.imap as any).oauth as any).refreshToken,'[redacted]');}finally{await imap.close();await new Promise<void>(resolve=>smtp.close(()=>resolve()));await new Promise<void>(resolve=>oauth.close(()=>resolve()));}
});
test('Periodic IMAP polling runs actual mailbox read, deduplicates and stops cleanly',async()=>{
  const imap=await imapServer();let received=0;const api=new IntegrationService(new MemoryStore(),{encryptionKey:randomBytes(32),inbound:async()=>{received++;return {task:{id:'poll-task'}};}});
  try{const c=api.create({kind:'email',name:'Polling',config:{dotId:'dot',allowedSenders:['allowed@example.test'],smtp:{host:'127.0.0.1',port:1,secure:false,user:'dot@example.test',password:'test'},imap:{host:'127.0.0.1',port:imap.port,secure:false,user:'dot@example.test',password:'test'}},scopes:['mail:read']});api.start({emailPollMs:20,outboxRetryMs:20});await Promise.all([api.pollEmail(c.id),api.pollEmail(c.id)]);await new Promise(resolve=>setTimeout(resolve,50));await api.stop();assert.equal(received,1);assert(imap.commands.some(c=>c.startsWith('UID FETCH')));const commandCount=imap.commands.length;await new Promise(resolve=>setTimeout(resolve,40));assert.equal(imap.commands.length,commandCount);}finally{await api.stop();await imap.close();}
});
