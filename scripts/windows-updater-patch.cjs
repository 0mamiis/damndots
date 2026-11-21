'use strict';
const MARKER='/* damndots-windows-updater-v1 */';
const DEFAULT_FAMILY='OpenAI.Codex_2p2nqsd0c76g0';
const DEFAULT_PUBLISHER='CN=50BDFD77-8903-4850-9FFE-6E8522F64D5B';
const DEFAULT_IDENTITY='OpenAI.Codex';

const QUERY_PS=[
 '$p=Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1;',
 'if($p){',
 '$m=Join-Path $p.InstallLocation "AppxManifest.xml";',
 '$pub="";',
 'if(Test-Path -LiteralPath $m){$pub=([xml](Get-Content -LiteralPath $m -Raw -Encoding UTF8)).Package.Identity.Publisher};',
 '[pscustomobject]@{name=$p.Name;family=$p.PackageFamilyName;fullName=$p.PackageFullName;version=$p.Version.ToString();publisher=$pub;installLocation=$p.InstallLocation}|ConvertTo-Json -Compress',
 '}'
].join(' ');

const META_PS=[
 '$ErrorActionPreference="Stop";',
 'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
 '$z=[IO.Compression.ZipFile]::OpenRead($env:DAMNDOTS_MSIX_PATH);',
 'try{',
 '$e=$z.GetEntry("AppxManifest.xml");',
 'if(-not $e){throw "Missing AppxManifest.xml"};',
 '$sr=New-Object IO.StreamReader($e.Open(),[Text.Encoding]::UTF8);',
 '[xml]$x=$sr.ReadToEnd();',
 '$id=$x.Package.Identity;',
 '[pscustomobject]@{packageIdentity=$id.Name;packagePublisher=$id.Publisher;architecture=$id.ProcessorArchitecture;packageVersion=$id.Version}|ConvertTo-Json -Compress',
 '}finally{$z.Dispose()}'
].join(' ');

const INSTALL_PS='$ErrorActionPreference="Stop"; Add-AppxPackage -Path $env:DAMNDOTS_MSIX_PATH';

function buildRuntimeHelper(){
 return [
  'function __damndotsWrapWindowsUpdater(raw,req){',
  ' if(!raw||typeof raw!=="object")return raw;',
  ' try{if(typeof raw.getCurrentPackageFamily==="function"&&String(raw.getCurrentPackageFamily()||"").trim())return raw;}catch{}',
  ' const load=typeof req==="function"?req:(typeof require==="function"?require:(m=>process.getBuiltinModule(m)));',
  ' const fs=load("node:fs"),path=load("node:path"),os=load("node:os"),cp=load("node:child_process");',
  ' const DEF_ID='+JSON.stringify(DEFAULT_IDENTITY)+',DEF_FAM='+JSON.stringify(DEFAULT_FAMILY)+',DEF_PUB='+JSON.stringify(DEFAULT_PUBLISHER)+';',
  ' const QUERY_PS='+JSON.stringify(QUERY_PS)+';',
  ' const META_PS='+JSON.stringify(META_PS)+';',
  ' const INSTALL_PS='+JSON.stringify(INSTALL_PS)+';',
  ' const PS=path.join(process.env.SystemRoot||"C:\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe");',
  ' const APP_DIR=path.dirname(process.execPath);',
  ' let cachedPkg=null;',
  ' function readRenewalVersion(){try{const r=JSON.parse(fs.readFileSync(path.join(APP_DIR,"renewal.json"),"utf8"));return typeof r.packageVersion==="string"?r.packageVersion.trim():"";}catch{return "";}}',
  ' function parsePkg(out){try{const p=JSON.parse(String(out||"").replace(/^\uFEFF/,"").trim());if(p&&p.family)return {name:p.name||DEF_ID,family:p.family||DEF_FAM,fullName:p.fullName||"",version:p.version||readRenewalVersion(),publisher:p.publisher||DEF_PUB,installLocation:p.installLocation||""};}catch{}return null;}',
  ' function fallbackPkg(){return {name:DEF_ID,family:DEF_FAM,fullName:"",version:readRenewalVersion(),publisher:DEF_PUB,installLocation:""};}',
  ' function getPkgSync(){if(cachedPkg)return cachedPkg;try{const out=cp.execFileSync(PS,["-NoProfile","-NonInteractive","-Command",QUERY_PS],{encoding:"utf8",windowsHide:true,timeout:8000});cachedPkg=parsePkg(out)||fallbackPkg();}catch{cachedPkg=fallbackPkg();}return cachedPkg;}',
  ' function getPkgAsync(){return new Promise(res=>{cp.execFile(PS,["-NoProfile","-NonInteractive","-Command",QUERY_PS],{encoding:"utf8",windowsHide:true,timeout:10000},(err,out)=>{const p=!err&&parsePkg(out);if(p)cachedPkg=p;res(p||cachedPkg||fallbackPkg());});});}',
  ' function isUnpackagedErr(e){const m=String(e&&e.message||e||"");return /packaged app identity|package identity|current package|APPMODEL_ERROR_NO_PACKAGE/i.test(m);}',
  ' function readMsixMetaFallback(msixPath){return new Promise((resolve,reject)=>{cp.execFile(PS,["-NoProfile","-NonInteractive","-Command",META_PS],{encoding:"utf8",windowsHide:true,timeout:15000,env:{...process.env,DAMNDOTS_MSIX_PATH:msixPath}},(err,out,se)=>{if(err)return reject(Error((se||err.message||"MSIX metadata read failed").trim()));try{const m=JSON.parse(String(out||"").replace(/^\uFEFF/,"").trim());const pkg=getPkgSync();const suffix=String(pkg.family||DEF_FAM).split("_").pop()||"2p2nqsd0c76g0";const arch=m.architecture==="x86_64"?"x64":(m.architecture||process.arch);resolve({packageIdentity:m.packageIdentity,packagePublisher:m.packagePublisher,architecture:arch,packageVersion:m.packageVersion,packageFullName:m.packageIdentity+"_"+m.packageVersion+"_"+arch+"__"+suffix});}catch(pe){reject(pe);}});});}',
  ' function installMsixFallback(msixPath,onProgress){return new Promise((resolve,reject)=>{try{onProgress&&onProgress(10);}catch{}let pct=15;const timer=setInterval(()=>{pct=Math.min(90,pct+5);try{onProgress&&onProgress(pct);}catch{}},1000);if(timer.unref)timer.unref();const child=cp.spawn(PS,["-NoProfile","-NonInteractive","-Command",INSTALL_PS],{windowsHide:true,stdio:["ignore","pipe","pipe"],env:{...process.env,DAMNDOTS_MSIX_PATH:msixPath}});let se="";child.stderr.on("data",d=>se+=d);child.once("error",e=>{clearInterval(timer);reject(e);});child.once("exit",code=>{clearInterval(timer);if(code===0){try{onProgress&&onProgress(100);}catch{}resolve();}else{reject(Error((se||("Add-AppxPackage exit "+code)).trim()));}});});}',
  ' const rawDep=raw.deployment&&typeof raw.deployment==="object"?raw.deployment:{};',
  ' const depProxy=new Proxy(rawDep,{get(target,prop,recv){',
  '  if(prop==="registerRestart")return arg=>{try{if(typeof target.registerRestart==="function")return target.registerRestart(arg);}catch{}};',
  '  if(prop==="readProcessState")return ()=>{try{if(typeof target.readProcessState==="function")return target.readProcessState();}catch{}const p=getPkgSync();return {packageFamilyName:p.family,packageVersion:readRenewalVersion()||p.version||"0.0.0.0",processCreationTimeUnixMs:Math.floor(Date.now()-process.uptime()*1000)};};',
  '  if(prop==="readRegistration")return async ()=>{try{if(typeof target.readRegistration==="function"){const r=await target.readRegistration();if(r&&r.version&&r.executablePath)return r;}}catch{}const p=await getPkgAsync();if(!p||!p.version)return null;const launcher=path.resolve(APP_DIR,"..","..","desktop-launcher.exe");const exe=fs.existsSync(launcher)?launcher:(p.installLocation?path.join(p.installLocation,"app","ChatGPT.exe"):process.execPath);return {version:p.version,executablePath:exe};};',
  '  const v=Reflect.get(target,prop,recv);return typeof v==="function"?v.bind(target):v;',
  ' }});',
  ' return new Proxy(raw,{get(target,prop,recv){',
  '  if(prop==="deployment")return depProxy;',
  '  if(prop==="getCurrentPackageFamily")return ()=>{try{const v=target.getCurrentPackageFamily();if(v&&String(v).trim())return v;}catch{}return getPkgSync().family;};',
  '  if(prop==="getCurrentPackagePublisher")return ()=>{try{const v=target.getCurrentPackagePublisher();if(v&&String(v).trim())return v;}catch{}return getPkgSync().publisher;};',
  '  if(prop==="getPackageLocalCachePath")return ()=>{try{const v=target.getPackageLocalCachePath();if(v&&String(v).trim())return v;}catch{}const base=process.env.LOCALAPPDATA||os.tmpdir();const dir=path.join(base,"Packages",getPkgSync().family,"LocalCache");try{fs.mkdirSync(dir,{recursive:true});}catch{}return dir;};',
  '  if(prop==="isStoreUpdateBlockedByPolicy")return ()=>{try{if(typeof target.isStoreUpdateBlockedByPolicy==="function")return target.isStoreUpdateBlockedByPolicy();}catch{}return false;};',
  '  if(prop==="readPackageMetadata")return async p=>{try{if(typeof target.readPackageMetadata==="function")return await target.readPackageMetadata(p);}catch(e){if(!isUnpackagedErr(e))throw e;}return await readMsixMetaFallback(p);};',
  '  if(prop==="stagePackage")return async p=>{try{if(typeof target.stagePackage==="function")return await target.stagePackage(p);}catch(e){if(!isUnpackagedErr(e))throw e;}if(!fs.existsSync(p))throw Error("MSIX package not found: "+p);};',
  '  if(prop==="activateStagedPackage")return async (p,onProgress,fullName)=>{try{if(typeof target.activateStagedPackage==="function")return await target.activateStagedPackage(p,onProgress,fullName);}catch(e){if(!isUnpackagedErr(e))throw e;}return await installMsixFallback(p,onProgress);};',
  '  const v=Reflect.get(target,prop,recv);return typeof v==="function"?v.bind(target):v;',
  ' }});',
  '}'
 ].join('\n');
}

function patchWindowsUpdater(source){
 if(source.includes(MARKER))return source;
 const re=/return ([A-Za-z0-9_$]+)\((?:\(0,([A-Za-z0-9_$]+)\.join\)|([A-Za-z0-9_$]+)\.join)\(process\.resourcesPath,"native","windows-updater\.node"\)\)/g;
 const matches=[...source.matchAll(re)];
 if(matches.length!==1)throw Error('Unsupported Windows updater loader boundary ('+matches.length+')');
 const patched=source.replace(re,(m,reqVar)=>m.replace(/^return /,'return __damndotsWrapWindowsUpdater(')+','+reqVar+')'+MARKER);
 return patched+'\n'+buildRuntimeHelper()+'\n';
}

module.exports={MARKER,DEFAULT_FAMILY,DEFAULT_PUBLISHER,DEFAULT_IDENTITY,buildRuntimeHelper,patchWindowsUpdater};
