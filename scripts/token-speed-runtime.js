// Read-only, trusted-renderer bridge for Codex TPS display preferences.
try {
 const electron=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
 electron.ipcMain.handle('damndots:token-speed',event=>{
  const url=String(event.senderFrame?.url||'');
  if(!url.startsWith('app://-/'))return null;
  const dir=path.join(os.homedir(),'.codex','dots-local-bridge');
  let value={enabled:true,aggregation:'average',decimals:0,animate:true};
  try{const saved=JSON.parse(fs.readFileSync(path.join(dir,'token-speed.json'),'utf8'));if(typeof saved.enabled==='boolean'&&['latest','average'].includes(saved.aggregation)&&[0,1,2].includes(saved.decimals)&&typeof saved.animate==='boolean')value={enabled:saved.enabled,aggregation:saved.aggregation,decimals:saved.decimals,animate:saved.animate};}catch{}
  try{fs.mkdirSync(dir,{recursive:true});const target=path.join(dir,'token-speed-status.json'),temp=target+'.tmp-'+process.pid;fs.writeFileSync(temp,JSON.stringify({pid:process.pid,preferences:value,updatedAt:new Date().toISOString()}),{mode:0o600});fs.renameSync(temp,target);}catch{}
  return value;
 });
}catch{}
