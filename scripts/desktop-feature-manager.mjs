import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
export const SUPPORTED=['26.1021.3705.0','26.1023.6621.0','26.1027.3384.0'];
export function provisionFeatureBridge(nativeDir,appRoot){
 const dir=path.join(os.homedir(),'.codex','dots-local-bridge');fs.mkdirSync(dir,{recursive:true,mode:0o700});
 for(const name of ['codex-local-tools-bridge.cjs','composer-prediction-settings.cjs','composer-prediction-models.cjs','token-speed-settings.cjs','orchestrator-settings.cjs'])fs.copyFileSync(path.join(repo,'scripts',name),path.join(dir,name==='codex-local-tools-bridge.cjs'?'bridge.cjs':name));
 const token=path.join(dir,'token.txt');if(!fs.existsSync(token))fs.writeFileSync(token,crypto.randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});
 const file=path.join(dir,'config.json');let config;try{config=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{}
 if(!config){const manifest=JSON.parse(fs.readFileSync(path.join(nativeDir,'cli-bridge.json'),'utf8'));config={localOnly:true,localPort:9915,remotePort:9914,nativeGateway:manifest.gateway,certificate:manifest.certificate,directory:dir};}
 config.composerAppRoot=appRoot;atomic(file,config);return {dir,script:path.join(dir,'bridge.cjs'),port:Number(config.localPort||9915)};
}
export function verifyApp(app){
 const a=fs.readFileSync(path.join(app,'resources/app.asar')),header=a.subarray(16,16+a.readUInt32LE(12)),meta=JSON.parse(header),base=8+a.readUInt32LE(4),exe=fs.readFileSync(path.join(app,'ChatGPT.exe'));
 const headerHash=sha(header);if(!exe.includes(Buffer.from(headerHash)))throw Error('Executable/archive header integrity mismatch');
 let checked=0;function walk(n){for(const v of Object.values(n.files||{})){if(v.files){walk(v);continue;}if(!v.integrity||v.unpacked)continue;const data=a.subarray(base+Number(v.offset),base+Number(v.offset)+v.size);if(data.length!==v.size||sha(data)!==v.integrity.hash)throw Error('Archive entry integrity mismatch');for(let i=0,j=0;i<data.length;i+=v.integrity.blockSize,j++)if(sha(data.subarray(i,i+v.integrity.blockSize))!==v.integrity.blocks[j])throw Error('Archive block integrity mismatch');checked++;}}walk(meta);
 return {archiveHash:sha(a),exeHash:sha(exe),headerHash,checked};
}
export function discoverPackage(){
 if(process.platform!=='win32')throw Error('Codex desktop features currently require Windows');
 return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-AppxPackage OpenAI.Codex | Select-Object -First 1 @{n="version";e={$_.Version.ToString()}},@{n="root";e={Join-Path $_.InstallLocation "app"}} | ConvertTo-Json -Compress'],{encoding:'utf8',windowsHide:true}).replace(/^\uFEFF/,''));
}
function atomic(file,v){const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(v,null,2),{mode:0o600});fs.renameSync(temp,file);}
export function ensureFeatures({nativeDir,adopt,sourcePackage=discoverPackage()}={}){
 nativeDir=path.resolve(nativeDir||path.join(repo,'.data/local-stack/native'));
 const dir=path.join(nativeDir,'desktop-features');fs.mkdirSync(dir,{recursive:true});
 const status=path.join(dir,'status.json');
 if(!SUPPORTED.includes(sourcePackage.version)){atomic(status,{state:'unsupported-version',packageVersion:sourcePackage.version,supported:SUPPORTED});return {state:'unsupported-version',dir};}
 const scripts=['patch-native-agent-features.cjs','patch-token-speed.cjs','patch-orchestrator-settings.cjs','patch-desktop-startup.cjs'];
 if(['26.1023.6621.0','26.1027.3384.0'].includes(sourcePackage.version))scripts.push('patch-permission-display.cjs');
 // 3384 reads accounts in the desktop main process, so the gateway cannot mark the local Dot as available.
 if(sourcePackage.version==='26.1027.3384.0')scripts.push('patch-orbit-navigation.cjs');
 if(sourcePackage.version==='26.1027.3384.0')scripts.push('patch-computer-viewer.cjs');
 if(sourcePackage.version==='26.1027.3384.0')scripts.push('patch-messaging-status.cjs');
 // Composer suggestions are opt-in: only patch the managed copy when this machine already has the setting.
 const composerPrefs=path.join(os.homedir(),'.codex','dots-local-bridge','composer-predictions.json');
 const composerEnabled=fs.existsSync(composerPrefs);
 if(composerEnabled)scripts.push('patch-composer-predictions.cjs');
 const assets=['desktop-features/orchestrator-ui.js','desktop-features/native-subpicker.cjs','desktop-features/opencodex-tps-main.js','token-speed-renderer.js','token-speed-runtime.js','orchestrator-renderer.js','orchestrator-runtime.js','desktop-startup-patch.cjs','desktop-renderer-bindings.cjs','desktop-build-targets.cjs'];
 if(composerEnabled)assets.push('native-prediction-preferences.js');
 if(['26.1023.6621.0','26.1027.3384.0'].includes(sourcePackage.version))assets.push('permission-display-patch.cjs','permission-display-renderer.js','permission-display-runtime.js');
 const revision=sha(Buffer.concat([...scripts,...assets].map(n=>fs.readFileSync(path.join(repo,'scripts',n)))));
 const app=path.join(dir,'app');let prior;try{prior=JSON.parse(fs.readFileSync(path.join(dir,'active.json'),'utf8'));}catch{}
 if(prior?.revision===revision&&prior.packageVersion===sourcePackage.version&&fs.existsSync(path.join(app,'ChatGPT.exe'))){const check=verifyApp(app);if(check.archiveHash!==prior.archiveHash||check.exeHash!==prior.exeHash)throw Error('Managed application integrity changed; refusing reuse');atomic(status,{state:'ready',packageVersion:prior.packageVersion,managedBy:'damndots',appRoot:app});return {state:'ready',dir,app};}
 const staging=path.join(dir,'staging');
 if(fs.existsSync(staging)){
  const marker=path.join(staging,'damndots-desktop-features.json');
  let pending;try{pending=JSON.parse(fs.readFileSync(marker,'utf8'));}catch{}
  if(pending?.revision!==revision||pending.packageVersion!==sourcePackage.version)throw Error('An unfinished or incompatible feature build requires inspection.');
  const integrity=verifyApp(staging);
  if(fs.existsSync(app)){try{const fd=fs.openSync(path.join(app,'ChatGPT.exe'),'r+');fs.closeSync(fd);}catch{atomic(status,{state:'waiting-for-codex-close',staging});return {state:'waiting-for-codex-close',dir};}fs.renameSync(app,path.join(dir,'previous-'+Date.now()));}
  fs.renameSync(staging,app);
  atomic(path.join(dir,'active.json'),{managedBy:'damndots',revision,packageVersion:sourcePackage.version,exe:path.join(app,'ChatGPT.exe'),...integrity});
  atomic(status,{state:'ready',managedBy:'damndots',packageVersion:sourcePackage.version,appRoot:app,checkedEntries:integrity.checked});
  return {state:'ready',dir,app};
 }
 fs.mkdirSync(staging,{recursive:true});atomic(status,{state:'building',packageVersion:sourcePackage.version});
 try{
  // Adoption is an explicit migration only; fresh installs start from the official package.
  const source=adopt?fs.realpathSync(adopt):sourcePackage.root;
  if(adopt){const rec=JSON.parse(fs.readFileSync(path.join(source,'renewal.json'),'utf8'));if(rec.packageVersion!==sourcePackage.version)throw Error('Legacy copy version differs from installed Codex');verifyApp(source);}
  const baselineDir=path.join(dir,'baseline');
  if(adopt&&!fs.existsSync(baselineDir)){
   fs.mkdirSync(path.join(baselineDir,'resources'),{recursive:true});
   for(const name of ['resources/app.asar','ChatGPT.exe','renewal.json'])fs.copyFileSync(path.join(source,name),path.join(baselineDir,name));
   atomic(path.join(baselineDir,'manifest.json'),{packageVersion:sourcePackage.version,managedBy:'damndots'});
  }
  fs.cpSync(source,staging,{recursive:true,filter:p=>!p.endsWith('.old')});
  if(!adopt&&fs.existsSync(path.join(baselineDir,'manifest.json'))){
   const baseline=JSON.parse(fs.readFileSync(path.join(baselineDir,'manifest.json'),'utf8'));
   if(baseline.packageVersion===sourcePackage.version)for(const name of ['resources/app.asar','ChatGPT.exe','renewal.json'])fs.copyFileSync(path.join(baselineDir,name),path.join(staging,name));
  }
  if(!fs.existsSync(path.join(staging,'renewal.json')))atomic(path.join(staging,'renewal.json'),{packageVersion:sourcePackage.version});
  for(const script of scripts)execFileSync(process.execPath,[path.join(repo,'scripts',script),staging],{windowsHide:true,stdio:'pipe'});
  const integrity=verifyApp(staging);
  atomic(path.join(staging,'damndots-desktop-features.json'),{managedBy:'damndots',schemaVersion:1,features:['token-speed','orchestrator'],packageVersion:sourcePackage.version,revision});
  // Never replace an active private app in place. Rename a released previous copy for recovery.
  if(fs.existsSync(app)){let fd;try{fd=fs.openSync(path.join(app,'ChatGPT.exe'),'r+');fs.closeSync(fd);}catch{atomic(status,{state:'waiting-for-codex-close',staging});return {state:'waiting-for-codex-close',dir};}fs.renameSync(app,path.join(dir,'previous-'+Date.now()));}
  fs.renameSync(staging,app);
  atomic(path.join(dir,'active.json'),{managedBy:'damndots',revision,packageVersion:sourcePackage.version,exe:path.join(app,'ChatGPT.exe'),...integrity});
  const bridgeDir=path.join(os.homedir(),'.codex','dots-local-bridge');
  if(fs.existsSync(path.join(bridgeDir,'config.json'))){const config=JSON.parse(fs.readFileSync(path.join(bridgeDir,'config.json'),'utf8').replace(/^\uFEFF/,''));config.composerAppRoot=app;atomic(path.join(bridgeDir,'config.json'),config);}
  const agents=path.join(os.homedir(),'.codex','agents');fs.mkdirSync(agents,{recursive:true});
  for(const name of ['lead','plan','explore','verify','fix','subagents']){const file=path.join(agents,name+'.toml');if(!fs.existsSync(file))fs.copyFileSync(path.join(repo,'scripts/desktop-features/agents',name+'.toml'),file,fs.constants.COPYFILE_EXCL);}
  atomic(status,{state:'ready',managedBy:'damndots',packageVersion:sourcePackage.version,appRoot:app,checkedEntries:integrity.checked});
  return {state:'ready',dir,app};
 }catch(error){atomic(status,{state:'failed',error:error.message,staging});throw error;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),value=k=>args[args.indexOf(k)+1];
 try{const result=ensureFeatures({nativeDir:args.includes('--native-dir')?value('--native-dir'):undefined,adopt:args.includes('--adopt')?value('--adopt'):undefined});console.log(JSON.stringify(result));}catch(e){console.error(e.message);process.exitCode=1;}
}
