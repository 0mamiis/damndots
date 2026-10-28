'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const defaults={enabled:true,aggregation:'average',decimals:0,animate:true};
function validate(v){
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!Object.hasOwn(defaults,k))||typeof v.enabled!=='boolean'||!['latest','average'].includes(v.aggregation)||![0,1,2].includes(v.decimals)||typeof v.animate!=='boolean')throw Error('Invalid token speed settings');
 return {enabled:v.enabled,aggregation:v.aggregation,decimals:v.decimals,animate:v.animate};
}
function read(dir,appRoot){
 let value=defaults,status={},manifest={};
 try{const {revision,...saved}=JSON.parse(fs.readFileSync(path.join(dir,'token-speed.json'),'utf8'));value=validate(saved);}catch{}
 try{status=JSON.parse(fs.readFileSync(path.join(dir,'token-speed-status.json'),'utf8'));}catch{}
 try{manifest=JSON.parse(fs.readFileSync(path.join(appRoot,'token-speed-patch.json'),'utf8'));}catch{}
 let alive=false;try{if(Number.isSafeInteger(status.pid)&&status.pid>0){process.kill(status.pid,0);alive=true;}}catch{}
 const connected=alive&&Date.now()-Date.parse(status.updatedAt)<10000;
 return {...value,installed:manifest.version===1,managedBy:fs.existsSync(path.join(appRoot,'damndots-desktop-features.json'))?'damndots':null,connected,applied:connected&&Object.keys(defaults).every(k=>status.preferences?.[k]===value[k]),updatedAt:connected?status.updatedAt:null};
}
function write(dir,v){const value=validate(v);fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'token-speed.json'),tmp=file+'.'+crypto.randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify({...value,revision:Date.now()}),{mode:0o600,flag:'wx'});fs.renameSync(tmp,file);}finally{try{fs.unlinkSync(tmp);}catch{}}return value;}
module.exports={defaults,validate,read,write};
