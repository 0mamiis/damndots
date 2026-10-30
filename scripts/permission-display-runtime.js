try{
 const electron=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
 electron.ipcMain.handle('damndots:permission-display',event=>{
  if(!String(event.senderFrame?.url||'').startsWith('app://-/'))return null;
  let hide=false;try{hide=JSON.parse(fs.readFileSync(path.join(os.homedir(),'.codex','dots-local-bridge','permission-display.json'),'utf8')).hideInformationDialogs===true;}catch{}
  return {hideInformationDialogs:hide};
 });
}catch{}
