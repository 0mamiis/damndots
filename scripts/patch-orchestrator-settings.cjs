'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=fs.realpathSync(process.argv[2]||''),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(root.toLowerCase().includes('windowsapps'))throw Error('Only patch a private staged copy');
const file=path.join(root,'resources/app.asar'),archive=fs.readFileSync(file),oldHeader=archive.subarray(16,16+archive.readUInt32LE(12)),meta=JSON.parse(oldHeader),base=8+archive.readUInt32LE(4),body=archive.subarray(base),changed=[];
function patch(entryPath,fn){let entry=meta;for(const part of entryPath.split('/'))entry=entry.files[part];const source=body.subarray(+entry.offset,+entry.offset+entry.size).toString();const result=fn(source);cp.execFileSync(process.execPath,['--input-type=module','--check'],{input:result});const bytes=Buffer.from(result);entry.offset=String(body.length+changed.reduce((n,x)=>n+x.bytes.length,0));entry.size=bytes.length;entry.integrity.hash=hash(bytes);entry.integrity.blocks=[];for(let i=0;i<bytes.length;i+=entry.integrity.blockSize)entry.integrity.blocks.push(hash(bytes.subarray(i,i+entry.integrity.blockSize)));changed.push({entryPath,bytes});}
function rep(s,a,b){if(s.split(a).length!==2)throw Error('Token speed anchor changed: '+a);return s.replace(a,b);}
const assets=meta.files.webview.files.assets.files,initial=Object.keys(assets).find(n=>n.startsWith('app-initial-')&&n.endsWith('.js'));
patch('webview/assets/'+initial,s=>{
 if(s.includes('var damndotsOrchestratorPreferences'))throw Error('Orchestrator settings already patched');
 s=rep(s,'return mode && Object.prototype.hasOwnProperty.call(CODEX_ORCH_TEXT, mode) ? mode : null;','return mode && Object.prototype.hasOwnProperty.call(CODEX_ORCH_TEXT, mode) ? mode : String(scopeId).startsWith("draft:")?damndotsOrchestratorPreferences.mode:null;');
 s=rep(s,'if (!Object.prototype.hasOwnProperty.call(modes, draftKey)) return;','if (!Object.prototype.hasOwnProperty.call(modes, draftKey)) modes[draftKey]=damndotsOrchestratorPreferences.mode;');
 const begin=s.indexOf('function codexOrchestratorSubmodelGet()'),end=s.indexOf('function codexOrchestratorModelList()',begin);
 if(begin<0||end<0)throw Error('Subagent preference functions missing');
 let part=s.slice(begin,end);
 part=rep(part,'if (v && ((typeof v.model','if(v&&v.explicit===true)return null; if (v && ((typeof v.model');
 part=rep(part,'  return null;','  return damndotsOrchestratorPreferences.model||damndotsOrchestratorPreferences.fast?{model:damndotsOrchestratorPreferences.model,effort:damndotsOrchestratorPreferences.effort,fast:damndotsOrchestratorPreferences.fast}:null;');
 part=rep(part,'localStorage.removeItem(CODEX_ORCH_SUBMODEL_KEY);','localStorage.setItem(CODEX_ORCH_SUBMODEL_KEY,JSON.stringify({explicit:true}));');
 part=rep(part,'effort: v.effort || null }','effort: v.effort || null, fast:v.fast===true }');
 s=s.slice(0,begin)+part+s.slice(end);
 s=rep(s,'R.useEffect(damndotsWatchTpsPreferences,[]);','R.useEffect(damndotsWatchOrchestratorPreferences,[]);R.useEffect(damndotsWatchTpsPreferences,[]);');
 return s+'\n'+fs.readFileSync(path.join(__dirname,'orchestrator-renderer.js'),'utf8');
});
const primary=Object.keys(assets).find(n=>n.startsWith('app-primary-')&&n.endsWith('.js'));
patch('webview/assets/'+primary,s=>{
 const tick=String.fromCharCode(96),old='localStorage.getItem('+tick+'codex-orchestrator-subagent-model-v1'+tick+')||'+tick+tick;
 return rep(s,old,'localStorage.getItem('+tick+'codex-orchestrator-subagent-model-v1'+tick+')||JSON.stringify(window.__damndotsOrchestratorDefaults||null)');
});
const builds=meta.files['.vite'].files.build.files,main=Object.keys(builds).find(n=>n.startsWith('main-')&&n.endsWith('.js'));
patch('.vite/build/'+main,s=>s+'\n'+fs.readFileSync(path.join(__dirname,'orchestrator-runtime.js'),'utf8'));
const tick=String.fromCharCode(96);
patch('.vite/build/preload.js',s=>{const re=/([\w$]+)\.contextBridge\.exposeInMainWorld\(`electronBridge`,([\w$]+)\)/g;if([...s.matchAll(re)].length!==1)throw Error('Preload bridge boundary changed');return s.replace(re,(_,electron,bridge)=>bridge+'.getOrchestratorPreferences=()=>'+electron+'.ipcRenderer.invoke("damndots:orchestrator"),'+electron+'.contextBridge.exposeInMainWorld(`electronBridge`,'+bridge+')');});
const json=Buffer.from(JSON.stringify(meta)),payload=(4+json.length+3)&~3,pickle=Buffer.alloc(4+payload),head=Buffer.alloc(8);pickle.writeUInt32LE(payload);pickle.writeUInt32LE(json.length,4);json.copy(pickle,8);head.writeUInt32LE(4);head.writeUInt32LE(pickle.length,4);
const result=Buffer.concat([head,pickle,body,...changed.map(x=>x.bytes)]),exe=fs.readFileSync(path.join(root,'ChatGPT.exe')),needle=Buffer.from(hash(oldHeader)),at=exe.indexOf(needle);if(at<0||exe.indexOf(needle,at+1)>=0)throw Error('EXE integrity anchor changed');Buffer.from(hash(json)).copy(exe,at);
fs.writeFileSync(file,result);fs.writeFileSync(path.join(root,'ChatGPT.exe'),exe);
const rec=JSON.parse(fs.readFileSync(path.join(root,'renewal.json'),'utf8'));Object.assign(rec,{headerHash:hash(json),exeHash:hash(exe),archiveHash:hash(result),orchestratorSettingsPatch:1});fs.writeFileSync(path.join(root,'renewal.json'),JSON.stringify(rec,null,2));fs.writeFileSync(path.join(root,'orchestrator-settings-patch.json'),JSON.stringify({version:1}));console.log('Orchestrator settings staged; three complete ESM modules parsed; archive and executable integrity updated.');
