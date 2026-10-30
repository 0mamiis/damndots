'use strict';
// Locate the Electron main-process chunk by content when Codex changes chunk names between releases.
function mainBuildName(entries,readText){
 const names=Object.keys(entries).filter(n=>/\.js$/.test(n));
 const legacy=names.find(n=>/^main-.*\.js$/.test(n));
 if(legacy)return legacy;
 const candidates=names.filter(n=>/^early-bootstrap-\d+-.*\.js$/.test(n)&&readText(n).includes('requestSingleInstanceLock')&&readText(n).includes('ipcMain'));
 if(candidates.length!==1)throw Error('Electron main process chunk not found or ambiguous');
 return candidates[0];
}
// Add one bridge property to the preload. The Electron owner is read from the current bundle, never assumed.
function addPreloadBridge(s,name,template){
 const inline=[...s.matchAll(/([\w$]+)\.contextBridge\.exposeInMainWorld\((["`])electronBridge\2,\{/g)];
 if(inline.length===1){const m=inline[0],owner=m[1],value=template.split('{OWNER}').join(owner);return s.replace(m[0],()=>owner+'.contextBridge.exposeInMainWorld('+m[2]+'electronBridge'+m[2]+',{'+name+':'+value+',');}
 const legacy=[...s.matchAll(/([\w$]+)\.contextBridge\.exposeInMainWorld\(`electronBridge`,([\w$]+)\)/g)];
 if(legacy.length===1){const m=legacy[0],owner=m[1],bridge=m[2],value=template.split('{OWNER}').join(owner);return s.replace(m[0],()=>bridge+'.'+name+'='+value+','+m[0]);}
 throw Error('Preload electron bridge boundary changed');
}
module.exports={mainBuildName,addPreloadBridge};
