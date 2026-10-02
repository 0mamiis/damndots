import {randomUUID} from 'node:crypto';
import type {RecordStore} from '@dots/contracts';
import {SecretVault} from './integrations/security.js';
export interface IceEntry {id?:string;urls:string[];username?:string;credential?:string;}
export class ComputerTransport {
 constructor(private store:RecordStore,private vault:SecretVault){}
 private read():IceEntry[]{const record=this.store.get<any>('computer_transport','owner');return record?this.vault.open(record.encrypted).entries:[];}
 list(){return {items:this.read().map(e=>({id:e.id,urls:e.urls,username:e.username||'',hasCredential:!!e.credential}))};}
 save(entries:IceEntry[]){const prior=this.read();const next=entries.map(e=>{if(!e.urls.length||e.urls.some(u=>! /^(stun|turn|turns):[^\s]+$/i.test(u)))throw Object.assign(Error('ICE adresleri stun:, turn: veya turns: biçiminde olmalı.'),{statusCode:400});const old=e.id?prior.find(p=>p.id===e.id):undefined;return {...e,id:old?.id||randomUUID(),credential:e.credential===undefined?old?.credential||'':e.credential};});this.store.put('computer_transport',{id:'owner',encrypted:this.vault.seal({entries:next})});return this.list();}
 iceServers(){return this.read().map(({urls,username,credential})=>({urls,...username?{username}:{},...credential?{credential}:{}}));}
}
