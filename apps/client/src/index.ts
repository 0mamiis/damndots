import { NativeGateway } from './gateway.js';
import { resolve, join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { readFile } from 'node:fs/promises';
import https from 'node:https';
import { enterMainProfile, leaveMainProfile } from './main-profile.js';

const args=process.argv.slice(2),has=(key:string)=>args.includes(key);
const value=(key:string)=>args[args.indexOf(key)+1];
const dataDir=resolve(process.env.DOTS_CLIENT_DATA_DIR||'.data/client');
const main=has('--main-profile'),external=has('--external-gateway');
const scripts=fileURLToPath(new URL('../../../scripts/main-codex/',import.meta.url));
const mainHome=resolve(process.env.DOTS_MAIN_CODEX_HOME||join(homedir(),'.codex'));
const mainData=resolve(process.env.DOTS_MAIN_USER_DATA||join(process.env.APPDATA||join(homedir(),'AppData','Roaming'),'Codex','web','Codex'));
const isolated=!!process.env.DOTS_MAIN_USER_DATA;
const stateDir=join(dataDir,'main-profile'),privateApp=join(dataDir,'app');
const server=has('--server')?value('--server'):process.env.DOTS_SERVER_URL||'http://127.0.0.1:9340';
const port=has('--port')?Number(value('--port')):8000;
const sh=(file:string,argv:string[])=>promisify(execFile)(file,argv,{windowsHide:true,maxBuffer:16*1024*1024,env:{...process.env,PSModulePath:undefined}});
const ps=(file:string,argv:string[]=[])=>sh('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file,...argv]);
async function appProcesses():Promise<{pid:number;path:string}[]> {
  const r=await sh('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Get-CimInstance Win32_Process -Filter \"Name='ChatGPT.exe'\" | ForEach-Object { [string]$_.ProcessId+'|'+$_.ExecutablePath }"]);
  return r.stdout.split(/\r?\n/).filter(Boolean).map(line=>{const i=line.indexOf('|');return {pid:Number(line.slice(0,i)),path:line.slice(i+1).trim()};}).filter(p=>p.pid&&p.path);
}
const belongs=(path:string,root:string)=>path.toLowerCase().startsWith(root.toLowerCase()+'\\');
if(has('--restore-main-profile')){
  if((await appProcesses()).length)throw new Error('Profil geri yüklemeden önce Codex penceresini kapatın.');
  console.log(await leaveMainProfile(mainHome,stateDir)?'Ana profil özgün haline döndürüldü.':'Geri alınacak bir değişiklik yok.');
  process.exit(0);
}
if(main&&!has('--launch'))throw new Error('Servis modu ana profili değiştiremez; --main-profile yalnızca kullanıcı Codex simgesini açınca kullanılır.');
if(external&&!main)throw new Error('Harici ağ geçidi yalnızca ana Codex açılışıyla kullanılır.');

let gateway:NativeGateway|undefined,changed=false,ownedGateway=false;
async function cleanup(){
  if(ownedGateway)await gateway?.close().catch(()=>{});
  if(changed){await leaveMainProfile(mainHome,stateDir);changed=false;console.log('Ana profil özgün haline döndürüldü.');}
}
try {
  let appPath:string|undefined;
  if(has('--launch')){
    if(process.platform!=='win32')throw new Error('Codex uygulama başlatıcısı Windows gerektirir.');
    if(main&&!isolated&&(await appProcesses()).length)throw new Error('Codex zaten açık. İkinci pencere açılmadı; önce açık pencereyi kapatın.');
    appPath=has('--app')?value('--app'):process.env.DOTS_CODEX_APP;
    if(!appPath)appPath=(await sh('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Join-Path (Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1).InstallLocation 'app'"])).stdout.trim();
    if(!appPath)throw new Error('Kurulu Codex uygulaması bulunamadı.');
    // Yama hata verirse profil henüz değiştirilmemiş olur.
    await sh(process.execPath,[fileURLToPath(new URL('../scripts/prepare-isolated-app.cjs',import.meta.url)),appPath,privateApp,'https://localhost:'+port]);
  }
  if(main){
    await leaveMainProfile(mainHome,stateDir); // önceki çökmüş oturumun gerçek ayarlarını geri al
    if(!isolated){
      const backup=(await ps(join(scripts,'backup.ps1'))).stdout;
      const dir=/BACKUP_DIR=(.+)/.exec(backup)?.[1]?.trim();
      if(!dir)throw new Error('Yedek oluşturulamadı.');
      // Kullanılan yedek her açılışta hash ile doğrulanır; doğrulama gerçek profile yazmaz.
      await ps(join(scripts,'verify-restore.ps1'),['-BackupDir',dir]);
      console.log((/BACKUP_NEW=1/.test(backup)?'Yedek alındı: ':'Mevcut yedek doğrulandı: ')+dir);
    }
    await enterMainProfile(mainHome,stateDir);changed=true;
  }
  gateway=new NativeGateway({server,enrollment:has('--enrollment')?value('--enrollment'):process.env.DOTS_CLIENT_ENROLLMENT,dataDir,port,codexHome:main?mainHome:undefined});
  let ready:{port:number;certificate:string;codexHome:string};
  if(external){
    const cert=join(dataDir,'certs','ca.pem'),ca=await readFile(cert);
    await new Promise<void>((yes,no)=>{
      const r=https.get('https://localhost:'+port+'/health',{ca,timeout:5000},res=>{
        let text='';res.on('data',b=>text+=b);res.on('end',()=>{try{const j=JSON.parse(text);if(res.statusCode===200&&j.service==='dots-native-gateway')yes();else no(new Error('Dots ağ geçidi hazır değil.'));}catch{no(new Error('Geçersiz ağ geçidi yanıtı.'));}});
      });r.on('error',no);r.on('timeout',()=>r.destroy(new Error('Dots ağ geçidi zaman aşımı.')));
    });
    await gateway.enroll(); // yalnızca bu MANUEL açılışta geçici ana profil ayarları yazılır
    ready={port,certificate:cert,codexHome:mainHome};
  }else{ready=await gateway.start();ownedGateway=true;console.log('Dots ağ geçidi hazır: https://localhost:'+port);}
  if(!has('--launch')){
    // Start-Dots.cmd bu kolda kalır: Codex.exe/ChatGPT.exe hiç çalıştırılmaz.
    for(const sig of ['SIGINT','SIGTERM'] as const)process.once(sig,async()=>{await cleanup();process.exit(0);});
  }else{
    const env={...process.env};for(const k of Object.keys(env))if(k.startsWith('CODEX'))delete env[k];
    Object.assign(env,{CODEX_HOME:ready.codexHome,CODEX_CA_CERTIFICATE:ready.certificate,SSL_CERT_FILE:ready.certificate,NODE_EXTRA_CA_CERTS:ready.certificate,CODEX_API_BASE_URL:'https://localhost:'+port+'/backend-api',CODEX_APP_SERVER_CHATGPT_BASE_URL:'https://localhost:'+port+'/backend-api',CODEX_APP_SERVER_OPENAI_BASE_URL:'https://localhost:'+port+'/backend-api/codex',CODEX_APP_SERVER_LOGIN_ISSUER:'https://localhost:'+port+'/auth',CODEX_APP_SERVER_LOGIN_CLIENT_ID:'app_local_orbit',CODEX_REFRESH_TOKEN_URL_OVERRIDE:'https://localhost:'+port+'/auth/oauth/token',CODEX_REVOKE_TOKEN_URL_OVERRIDE:'https://localhost:'+port+'/auth/oauth/revoke',ORBIT_DURABLE_WS_URL:'wss://localhost:'+port+'/native/app-server'});
    const child=spawn(join(privateApp,'ChatGPT.exe'),['--user-data-dir='+(main?mainData:join(dataDir,'profile')),'--ignore-certificate-errors','--host-resolver-rules=MAP ws.chatgpt.com 127.0.0.1:'+port,...has('--debug-port')?['--remote-debugging-port='+value('--debug-port')]:[]],{env,detached:!main,stdio:'ignore'});
    if(!main){child.unref();console.log('Test Codex kopyası açıldı.');}
    else {
      console.log('Ana Codex profiliyle tek pencere açılıyor.');
      let stopping=false;
      const stop=()=>{if(!stopping){stopping=true;child.kill();}};
      for(const sig of ['SIGINT','SIGTERM'] as const)process.once(sig,stop);
      await new Promise<void>((yes,no)=>{child.once('exit',()=>yes());child.once('error',no);});
      // Electron başlangıç süreci çıkarsa, gerçek kopya kapanana kadar profil korunur.
      while((await appProcesses()).some(p=>belongs(p.path,privateApp)))await new Promise(r=>setTimeout(r,500));
      await cleanup();
      for(const sig of ['SIGINT','SIGTERM'] as const)process.off(sig,stop);
    }
  }
}catch(error){
  await cleanup();
  throw error;
}
