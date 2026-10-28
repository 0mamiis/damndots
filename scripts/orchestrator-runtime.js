try{
 const electron=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
 electron.ipcMain.handle('damndots:orchestrator',event=>{
  if(!String(event.senderFrame?.url||'').startsWith('app://-/'))return null;
  const dir=path.join(os.homedir(),'.codex','dots-local-bridge');let value={mode:'off',model:null,effort:null,fast:false};
  try{const v=JSON.parse(fs.readFileSync(path.join(dir,'orchestrator.json'),'utf8'));if(['off','lead','plan','explore','verify','fix','subagents'].includes(v.mode)&&(v.model===null||typeof v.model==='string'&&v.model.length<=300)&&[null,'none','minimal','low','medium','high','xhigh','max','ultra'].includes(v.effort)&&typeof v.fast==='boolean')value={mode:v.mode,model:v.model,effort:v.effort,fast:v.fast};}catch{}
  try{fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'orchestrator-status.json'),tmp=file+'.tmp-'+process.pid;fs.writeFileSync(tmp,JSON.stringify({pid:process.pid,preferences:value,updatedAt:new Date().toISOString()}),{mode:0o600});fs.renameSync(tmp,file);}catch{}
  return value;
 });
}catch{}
