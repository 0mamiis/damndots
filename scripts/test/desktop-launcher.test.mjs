import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
let version='';
if(process.platform==='win32')try{version=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','(Get-AppxPackage -Name OpenAI.Codex|Select-Object -First 1).Version.ToString()'],{encoding:'utf8',windowsHide:true,timeout:10000}).trim();}catch{}
test('windowless launcher applies a verified update, forwards the environment and recovers a closing-instance handoff',{skip:!version},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dots-launch-fixture-')),dir=path.join(root,'desktop-features'),app=path.join(dir,'app'),pending=path.join(dir,'startup-update');
 try{
  fs.mkdirSync(path.join(app,'resources'),{recursive:true});fs.mkdirSync(path.join(pending,'resources'),{recursive:true});
  const code=`using System;using System.IO;using System.Threading;public static class Fixture{public static void Main(){string f=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"count.txt");int n=File.Exists(f)?int.Parse(File.ReadAllText(f)):0;File.WriteAllText(f,(n+1).ToString());File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"env.txt"),Environment.GetEnvironmentVariable("DOTS_LAUNCH_FIXTURE"));if(n>0)Thread.Sleep(2500);}}`;
  const stub=path.join(root,'fixture.cs');fs.writeFileSync(stub,code);
  const launcherSource=path.resolve('scripts/main-codex/desktop-launcher.cs'),compile=path.join(root,'compile.ps1');
  fs.writeFileSync(compile,`$ErrorActionPreference='Stop'\nAdd-Type -TypeDefinition ([IO.File]::ReadAllText(${quote(stub)})) -OutputAssembly ${quote(path.join(pending,'ChatGPT.exe'))} -OutputType WindowsApplication\nAdd-Type -TypeDefinition ([IO.File]::ReadAllText(${quote(launcherSource)})) -OutputAssembly ${quote(path.join(root,'desktop-launcher.exe'))} -OutputType WindowsApplication -ReferencedAssemblies @('System.dll','System.Web.Extensions.dll')\n`);
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-STA','-File',compile],{windowsHide:true,timeout:20000});
  fs.writeFileSync(path.join(app,'ChatGPT.exe'),'previous executable fixture');
  for(const n of ['renewal.json','damndots-desktop-features.json']){fs.writeFileSync(path.join(app,n),'{}');fs.writeFileSync(path.join(pending,n),'{}');}
  fs.writeFileSync(path.join(app,'resources/app.asar'),'old fixture');fs.writeFileSync(path.join(pending,'resources/app.asar'),'new fixture');
  const active={exe:path.join(app,'ChatGPT.exe'),packageVersion:version,exeHash:sha(fs.readFileSync(path.join(app,'ChatGPT.exe')))};
  fs.writeFileSync(path.join(dir,'active.json'),JSON.stringify(active));
  const next={...active,exeHash:sha(fs.readFileSync(path.join(pending,'ChatGPT.exe'))),archiveHash:sha(fs.readFileSync(path.join(pending,'resources/app.asar')))};
  fs.writeFileSync(path.join(pending,'active.json'),JSON.stringify(next));fs.writeFileSync(path.join(dir,'heartbeat'),'test');fs.writeFileSync(path.join(root,'environment.json'),JSON.stringify({environment:{DOTS_LAUNCH_FIXTURE:'preserved'}}));
  execFileSync(path.join(root,'desktop-launcher.exe'),['--managed'],{windowsHide:true,timeout:20000});
  assert.equal(fs.readFileSync(path.join(app,'count.txt'),'utf8'),'2');assert.equal(fs.readFileSync(path.join(app,'env.txt'),'utf8'),'preserved');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'active.json'))),next);assert(fs.existsSync(path.join(pending,'applied.json')));
  assert.equal(fs.readFileSync(path.join(pending,'app.asar.previous'),'utf8'),'old fixture');
  assert.match(fs.readFileSync(path.join(root,'desktop-launcher.log'),'utf8'),/attempt=1/);
 }finally{
  await new Promise(resolve=>setTimeout(resolve,1200));
  assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
test('windowless launcher forwards codex protocol arguments verbatim without logging sensitive query strings',{skip:!version},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dots-launch-proto-')),dir=path.join(root,'desktop-features'),app=path.join(dir,'app');
 try{
  fs.mkdirSync(path.join(app,'resources'),{recursive:true});
  const code=`using System;using System.IO;using System.Threading;public static class Fixture{public static void Main(string[] args){File.WriteAllLines(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"args.txt"),args);Thread.Sleep(2500);}}`;
  const stub=path.join(root,'fixture.cs');fs.writeFileSync(stub,code);
  const launcherSource=path.resolve('scripts/main-codex/desktop-launcher.cs'),compile=path.join(root,'compile.ps1');
  fs.writeFileSync(compile,["$ErrorActionPreference='Stop'",`Add-Type -TypeDefinition ([IO.File]::ReadAllText(${quote(stub)})) -OutputAssembly ${quote(path.join(app,'ChatGPT.exe'))} -OutputType WindowsApplication`,`Add-Type -TypeDefinition ([IO.File]::ReadAllText(${quote(launcherSource)})) -OutputAssembly ${quote(path.join(root,'desktop-launcher.exe'))} -OutputType WindowsApplication -ReferencedAssemblies @('System.dll','System.Web.Extensions.dll')`].join('\n'));
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-STA','-File',compile],{windowsHide:true,timeout:20000});
  const active={exe:path.join(app,'ChatGPT.exe'),packageVersion:version,exeHash:sha(fs.readFileSync(path.join(app,'ChatGPT.exe')))};
  fs.writeFileSync(path.join(dir,'active.json'),JSON.stringify(active));fs.writeFileSync(path.join(dir,'heartbeat'),'test');
  const url='codex://settings/connections?code=secret_oauth_code_123&state=codex_scheme__oauth_s_abc';
  execFileSync(path.join(root,'desktop-launcher.exe'),['--managed','--','--single-argument',url],{windowsHide:true,timeout:20000});
  const received=fs.readFileSync(path.join(app,'args.txt'),'utf8').trim().split(/\r?\n/);
  assert.deepEqual(received,['--single-argument',url]);
  const log=fs.readFileSync(path.join(root,'desktop-launcher.log'),'utf8');
  assert.match(log,/args=forwarded/);
  assert.doesNotMatch(log,/secret_oauth_code_123|oauth_s_abc/);
 }finally{
  await new Promise(resolve=>setTimeout(resolve,1200));
  assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
test('native resume helper reads protocol arguments from a suspended process PEB',{skip:process.platform!=='win32'},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dots-resume-peb-'));
 try{
  const resumeSource=path.resolve('scripts/main-codex/native-resume.cs');
  const probe=path.join(root,'probe.ps1');
  const url='codex://settings/connections?code=test999&state=codex_scheme__oauth_s_xyz';
  fs.writeFileSync(probe,[
   "$ErrorActionPreference='Stop'",
   `$helperSrc = @'`,
   'public static class SuspSpawn {',
   ' [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]struct STARTUPINFO{public int cb;public string a,b,c;public int d,e,f,g,h,i,j,k;public short l,m;public IntPtr n,o,p,q;}',
   ' [StructLayout(LayoutKind.Sequential)]struct PROCESS_INFORMATION{public IntPtr hProcess,hThread;public uint dwProcessId,dwThreadId;}',
   ' [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CreateProcess(string app,string cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFO si,out PROCESS_INFORMATION pi);',
   ' [DllImport("kernel32.dll",SetLastError=true)]static extern bool TerminateProcess(IntPtr p,uint code);',
   ' [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr h);',
   ' public static string Probe(string exe,string args){',
   '  var si=new STARTUPINFO{cb=Marshal.SizeOf(typeof(STARTUPINFO))};PROCESS_INFORMATION pi;',
   '  if(!CreateProcess(exe,"\\""+exe+"\\" "+args,IntPtr.Zero,IntPtr.Zero,false,4,IntPtr.Zero,null,ref si,out pi))throw new Exception("CreateProcess failed: "+Marshal.GetLastWin32Error());',
   '  try{return DotsNativeResume.ExtractArgs(DotsNativeResume.ReadCommandLine(pi.dwProcessId));}',
   '  finally{TerminateProcess(pi.hProcess,0);CloseHandle(pi.hThread);CloseHandle(pi.hProcess);}',
   ' }',
   '}',
   "'@",
   `Add-Type -TypeDefinition (([IO.File]::ReadAllText(${quote(resumeSource)})) + "\n" + $helperSrc)`,
   `[SuspSpawn]::Probe((Join-Path $env:WINDIR 'System32\\cmd.exe'), '--single-argument ${url}')`
  ].join('\n'));
  const out=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',probe],{encoding:'utf8',windowsHide:true,timeout:20000}).trim();
  assert.equal(out,'--single-argument '+url);
 }finally{
  assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
test('windowless launcher waits for a slow-closing managed process before launching a fresh instance',{skip:!version},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'dots-launch-slowquit-')),dir=path.join(root,'desktop-features'),app=path.join(dir,'app');
 let holder=null;
 try{
  fs.mkdirSync(path.join(app,'resources'),{recursive:true});
  const code=`using System;using System.IO;using System.Threading;public static class Fixture{public static void Main(string[] args){string b=AppDomain.CurrentDomain.BaseDirectory;string lockFile=Path.Combine(b,"dying.lock");if(args.Length>0&&args[0]=="--hold"){File.WriteAllText(lockFile,"1");Thread.Sleep(3200);try{File.Delete(lockFile);}catch{}return;}string f=Path.Combine(b,"count.txt");int n=File.Exists(f)?int.Parse(File.ReadAllText(f)):0;File.WriteAllText(f,(n+1).ToString());if(File.Exists(lockFile))return;Thread.Sleep(2500);}}`;
  const stub=path.join(root,'fixture.cs');fs.writeFileSync(stub,code);
  const launcherSource=path.resolve('scripts/main-codex/desktop-launcher.cs'),compile=path.join(root,'compile.ps1');
  fs.writeFileSync(compile,`$ErrorActionPreference='Stop'\nAdd-Type -TypeDefinition ([IO.File]::ReadAllText(${quote(stub)})) -OutputAssembly ${quote(path.join(app,'ChatGPT.exe'))} -OutputType WindowsApplication\nAdd-Type -TypeDefinition ([IO.File]::ReadAllText(${quote(launcherSource)})) -OutputAssembly ${quote(path.join(root,'desktop-launcher.exe'))} -OutputType WindowsApplication -ReferencedAssemblies @('System.dll','System.Web.Extensions.dll')\n`);
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-STA','-File',compile],{windowsHide:true,timeout:20000});
  const active={exe:path.join(app,'ChatGPT.exe'),packageVersion:version,exeHash:sha(fs.readFileSync(path.join(app,'ChatGPT.exe')))};
  fs.writeFileSync(path.join(dir,'active.json'),JSON.stringify(active));fs.writeFileSync(path.join(dir,'heartbeat'),'test');
  const {spawn}=await import('node:child_process');
  holder=spawn(path.join(app,'ChatGPT.exe'),['--hold'],{windowsHide:true,stdio:'ignore'});
  for(let i=0;i<30&&!fs.existsSync(path.join(app,'dying.lock'));i++)await new Promise(r=>setTimeout(r,100));
  assert(fs.existsSync(path.join(app,'dying.lock')));
  execFileSync(path.join(root,'desktop-launcher.exe'),['--managed'],{windowsHide:true,timeout:20000});
  assert.equal(fs.readFileSync(path.join(app,'count.txt'),'utf8'),'2');
  const log=fs.readFileSync(path.join(root,'desktop-launcher.log'),'utf8');
  assert.match(log,/Closing managed process exited; retrying launch/);
  assert.match(log,/attempt=1/);
 }finally{
  try{holder?.kill();}catch{}
  await new Promise(resolve=>setTimeout(resolve,1500));
  assert(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
