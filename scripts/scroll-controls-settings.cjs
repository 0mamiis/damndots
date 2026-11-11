'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const defaults={enabled:true,thinking:true,model:true,mode:true};
function validate(v){
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!Object.hasOwn(defaults,k))||Object.keys(defaults).some(k=>typeof v[k]!=='boolean'))throw Error('Invalid scroll control settings');
 return {enabled:v.enabled,thinking:v.thinking,model:v.model,mode:v.mode};
}
function read(dir,appRoot){
 let value=defaults,status={};
 try{const {revision,...saved}=JSON.parse(fs.readFileSync(path.join(dir,'scroll-controls.json'),'utf8'));value=validate(saved);}catch{}
 try{status=JSON.parse(fs.readFileSync(path.join(dir,'scroll-controls-status.json'),'utf8'));}catch{}
 let alive=false;try{if(Number.isSafeInteger(status.pid)&&status.pid>0){process.kill(status.pid,0);alive=true;}}catch{}
 const connected=alive&&Date.now()-Date.parse(status.updatedAt)<10000;
 const managed=fs.existsSync(path.join(appRoot,'damndots-desktop-features.json'));
 return {...value,installed:managed,managedBy:managed?'damndots':null,connected,applied:connected&&Object.keys(defaults).every(k=>status.preferences?.[k]===value[k])};
}
function write(dir,v){const value=validate(v);fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'scroll-controls.json'),tmp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify({...value,revision:Date.now()}),{mode:0o600,flag:'wx'});fs.renameSync(tmp,file);}finally{try{fs.unlinkSync(tmp);}catch{}}return value;}
module.exports={defaults,validate,read,write};
