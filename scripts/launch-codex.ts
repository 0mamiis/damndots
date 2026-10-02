// Legacy desktop link remains valid, but activates the original MSIX application.
// Dots environment is supplied by Windows package activation while its services are running.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {acquireLaunchLock} from '../apps/client/src/launch-policy.js';
const root=fileURLToPath(new URL('..',import.meta.url)),data=resolve(process.env.DOTS_STACK_DIR||join(root,'.data/local-stack'));
const sh=promisify(execFile);
const ps=(file:string,args:string[]=[])=>sh('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file,...args],{windowsHide:true,env:{...process.env,PSModulePath:undefined}});
const release=await acquireLaunchLock(join(data,'native/manual-launch.lock'));
if(!release){await ps(join(root,'scripts/main-codex/focus.ps1'),['-OriginalOnly']);console.log('Codex zaten acik veya aciliyor.');process.exit(0);}
try{
 const focus=join(root,'scripts/main-codex/focus.ps1');
 if((await ps(focus,['-QueryOnly','-OriginalOnly'])).stdout.includes('CODEX_OPEN=1')){
  await ps(focus,['-OriginalOnly']);console.log('Acik orijinal Codex penceresine gecildi.');
 }else{
  const packageFamily=(await sh('powershell.exe',['-NoProfile','-NonInteractive','-Command','(Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1).PackageFamilyName'],{windowsHide:true})).stdout.trim();
  if(!/^OpenAI\.Codex_[A-Za-z0-9]+$/.test(packageFamily))throw new Error('Kurulu Codex paketi bulunamadi.');
  await sh('explorer.exe',['shell:AppsFolder\\'+packageFamily+'!App'],{windowsHide:true});
  console.log('Orijinal Codex acildi.');
 }
}finally{await release();}
