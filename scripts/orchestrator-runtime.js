try{
 const electron=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
 electron.ipcMain.handle('damndots:orchestrator',event=>{
  if(!String(event.senderFrame?.url||'').startsWith('app://-/'))return null;
  const dir=path.join(os.homedir(),'.codex','dots-local-bridge');const toggleable=['lead','plan','explore','verify','fix','subagents','swarm'];let value={mode:'off',model:null,effort:null,fast:false,disabledModes:['fix','verify','explore'],modeOrder:['fix','verify','explore','plan','subagents','lead','swarm'],modeColors:{},showOffDetails:false};
  try{const v=JSON.parse(fs.readFileSync(path.join(dir,'orchestrator.json'),'utf8'));if(['off',...toggleable].includes(v.mode)&&(v.model===null||typeof v.model==='string'&&v.model.length<=300)&&[null,'none','minimal','low','medium','high','xhigh','max','ultra'].includes(v.effort)&&typeof v.fast==='boolean'){const d=Array.isArray(v.disabledModes)?toggleable.filter(m=>v.disabledModes.includes(m)):['fix','verify','explore'];const o=Array.isArray(v.modeOrder)&&v.modeOrder.every(m=>toggleable.includes(m))&&new Set(v.modeOrder).size===v.modeOrder.length?[...v.modeOrder,...toggleable.filter(m=>!v.modeOrder.includes(m))]:value.modeOrder;const mc={};if(v.modeColors&&typeof v.modeColors==='object')for(const m of toggleable)if(typeof v.modeColors[m]==='string'&&/^#[0-9a-f]{6}$/i.test(v.modeColors[m]))mc[m]=v.modeColors[m];value={mode:d.includes(v.mode)?'off':v.mode,model:v.model,effort:v.effort,fast:v.fast,disabledModes:d,modeOrder:o,modeColors:mc,showOffDetails:v.showOffDetails===true};}}catch{}
  try{fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'orchestrator-status.json'),tmp=file+'.tmp-'+process.pid;fs.writeFileSync(tmp,JSON.stringify({pid:process.pid,preferences:value,updatedAt:new Date().toISOString()}),{mode:0o600});fs.renameSync(tmp,file);}catch{}
  return value;
 });
}catch{}
