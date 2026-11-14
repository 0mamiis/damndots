'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
// Each scroll action has a switch, a modifier key and the part of the picker the pointer has to be over.
// keys: none | shift | ctrl | alt | ctrl+shift. zones: any | model | thinking | mode (the orchestrator mode label).
const actions=['thinking','model','mode','fast'],keys=['none','shift','ctrl','alt','ctrl+shift'],zones=['any','model','thinking','mode'];
const defaults={enabled:true,thinking:{on:true,key:'none',zone:'any'},model:{on:true,key:'shift',zone:'any'},mode:{on:true,key:'ctrl',zone:'any'},fast:{on:true,key:'alt',zone:'any'}};
function binding(name,v){
 // Older files stored a plain boolean per action; they keep the original key and zone of that action.
 if(typeof v==='boolean')return {...defaults[name],on:v};
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!['on','key','zone'].includes(k))||typeof v.on!=='boolean'||!keys.includes(v.key)||!zones.includes(v.zone))throw Error('Invalid scroll control settings');
 return {on:v.on,key:v.key,zone:v.zone};
}
function validate(v){
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!Object.hasOwn(defaults,k))||typeof v.enabled!=='boolean')throw Error('Invalid scroll control settings');
 const out={enabled:v.enabled};
 for(const name of actions)out[name]=name in v?binding(name,v[name]):{...defaults[name]};
 return out;
}
function read(dir,appRoot){
 let value=validate(defaults),status={};
 try{const {revision,...saved}=JSON.parse(fs.readFileSync(path.join(dir,'scroll-controls.json'),'utf8'));value=validate(saved);}catch{}
 try{status=JSON.parse(fs.readFileSync(path.join(dir,'scroll-controls-status.json'),'utf8'));}catch{}
 let alive=false;try{if(Number.isSafeInteger(status.pid)&&status.pid>0){process.kill(status.pid,0);alive=true;}}catch{}
 const connected=alive&&Date.now()-Date.parse(status.updatedAt)<10000;
 const managed=fs.existsSync(path.join(appRoot,'damndots-desktop-features.json'));
 let applied=false;try{applied=connected&&JSON.stringify(validate(status.preferences))===JSON.stringify(value);}catch{}
 return {...value,installed:managed,managedBy:managed?'damndots':null,connected,applied};
}
function write(dir,v){const value=validate(v);fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'scroll-controls.json'),tmp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify({...value,revision:Date.now()}),{mode:0o600,flag:'wx'});fs.renameSync(tmp,file);}finally{try{fs.unlinkSync(tmp);}catch{}}return value;}
module.exports={defaults,actions,keys,zones,validate,read,write};
