'use strict';
const fs=require('fs'),path=require('path');
function validate(value){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['enabled','model','effort','fast'].includes(k))||typeof value.enabled!=='boolean'||value.model!==undefined&&value.model!==null&&(typeof value.model!=='string'||!value.model.trim()||value.model.length>300||/[\r\n\x00]/.test(value.model))||value.effort!=null&&!['none','minimal','low','medium','high','xhigh','max','ultra'].includes(value.effort)||value.fast!==undefined&&typeof value.fast!=='boolean')throw new Error('Invalid composer preferences');return {...value,enabled:value.enabled,...typeof value.model==='string'?{model:value.model.trim()}:{}};}
function read(dir,appRoot){
 let preference={},status={},manifest={},installation={};
 try{preference=JSON.parse(fs.readFileSync(path.join(dir,'composer-predictions.json'),'utf8'));}catch{}
 try{status=JSON.parse(fs.readFileSync(path.join(dir,'composer-predictions-status.json'),'utf8'));}catch{}
 try{manifest=JSON.parse(fs.readFileSync(path.join(appRoot,'composer-predictions-patch.json'),'utf8'));}catch{}
 try{installation=JSON.parse(fs.readFileSync(path.join(dir,'composer-predictions-install.json'),'utf8'));}catch{}
 const enabled=typeof preference.enabled==='boolean'?preference.enabled:false;
 let alive=false;try{if(Number.isSafeInteger(status.pid)&&status.pid>0){process.kill(status.pid,0);alive=true;}}catch{}
 const installed=manifest.version>=1;
 const connected=installed&&alive&&Date.now()-Date.parse(status.updatedAt)<8000&&String(status.executable).toLowerCase()===path.join(appRoot,'ChatGPT.exe').toLowerCase();
 const model=typeof preference.model==='string'?preference.model:null;
 const effort=preference.effort??null,fast=preference.fast===true;
 return {enabled,model,effort,fast,installed,connected,restartRequired:installation.state==='waiting-for-app-close',applied:connected&&status.enabled===enabled&&(status.model??null)===model&&(status.effort??null)===effort&&(status.fast===true)===fast,remoteEnabled:connected&&typeof status.remoteEnabled==='boolean'?status.remoteEnabled:null,updatedAt:connected?status.updatedAt:null};
}
function write(dir,patch){const value=validate(patch);fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'composer-predictions.json'),temporary=file+'.tmp';let previous={};try{previous=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}fs.writeFileSync(temporary,JSON.stringify({enabled:value.enabled,model:value.model===undefined?previous.model??null:value.model,effort:value.effort===undefined?previous.effort??null:value.effort,fast:value.fast===undefined?previous.fast===true:value.fast,revision:Date.now()}),{mode:0o600});fs.renameSync(temporary,file);return value;}
module.exports={validate,read,write};
