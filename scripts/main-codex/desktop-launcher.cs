using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Threading;
using System.Web.Script.Serialization;
using System.Collections.Generic;

// A windowless, stable shortcut target. Never terminate a user process or automate its UI.
public static class DotsDesktopLauncher {
 static readonly string Root=AppDomain.CurrentDomain.BaseDirectory;
 static readonly string Dir=Path.Combine(Root,"desktop-features");
 static readonly string App=Path.Combine(Dir,"app");
 const string AppId="OpenAI.Codex_2p2nqsd0c76g0!App";
 const string PackageFamily="OpenAI.Codex_2p2nqsd0c76g0";
 [ComImport,Guid("2e941141-7f97-4756-ba1d-9decde894a3d"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface Activation {
  [PreserveSig]int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)]string id,[MarshalAs(UnmanagedType.LPWStr)]string args,uint options,out uint pid);
 }
 static void Original(string forwardArgs){var activation=(Activation)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")));try{uint pid;Marshal.ThrowExceptionForHR(activation.ActivateApplication(AppId,string.IsNullOrEmpty(forwardArgs)?null:forwardArgs,0,out pid));}finally{Marshal.ReleaseComObject(activation);}}
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern int GetPackagesByPackageFamily(string family,ref uint count,IntPtr[] names,ref uint bufLen,char[] buffer);
 [DllImport("shell32.dll",CharSet=CharSet.Unicode)]static extern int SetCurrentProcessExplicitAppUserModelID(string id);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr hwnd);
 static Dictionary<string,object> Json(string file){return new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(file));}
 static string Hash(string file){using(var sha=SHA256.Create())using(var f=File.OpenRead(file))return BitConverter.ToString(sha.ComputeHash(f)).Replace("-","").ToLowerInvariant();}
 static void Log(string message){try{File.AppendAllText(Path.Combine(Root,"desktop-launcher.log"),DateTime.UtcNow.ToString("o")+" "+message+Environment.NewLine);}catch{}}
 static bool LiveWindow(){foreach(var p in Process.GetProcessesByName("ChatGPT"))using(p){try{if(p.MainWindowHandle!=IntPtr.Zero&&IsWindowVisible(p.MainWindowHandle)&&String.Equals(p.MainModule.FileName,Path.Combine(App,"ChatGPT.exe"),StringComparison.OrdinalIgnoreCase))return true;}catch{}}return false;}
 static bool ManagedProcess(){foreach(var p in Process.GetProcessesByName("ChatGPT"))using(p){try{if(String.Equals(p.MainModule.FileName,Path.Combine(App,"ChatGPT.exe"),StringComparison.OrdinalIgnoreCase))return true;}catch{}}return false;}
 static void ApplyPending(){
  string pending=Path.Combine(Dir,"startup-update"),manifest=Path.Combine(pending,"active.json");
  if(!File.Exists(manifest)||ManagedProcess())return;
  var next=Json(manifest);var previous=Json(Path.Combine(Dir,"active.json"));
  if((string)next["packageVersion"]!=(string)previous["packageVersion"]){Log("Ignored startup update for an older package version");return;}
  if(Hash(Path.Combine(pending,"ChatGPT.exe"))!=(string)next["exeHash"]||Hash(Path.Combine(pending,"resources","app.asar"))!=(string)next["archiveHash"])throw new Exception("Pending integrity mismatch");
  string[] names={"resources/app.asar","ChatGPT.exe","renewal.json","damndots-desktop-features.json"};
  foreach(var name in names){string dest=Path.Combine(App,name);if(File.Exists(dest))File.Copy(dest,Path.Combine(pending,Path.GetFileName(name)+".previous"),true);}
  byte[] oldActive=File.ReadAllBytes(Path.Combine(Dir,"active.json"));
  try{foreach(var name in names)File.Copy(Path.Combine(pending,name),Path.Combine(App,name),true);File.Copy(manifest,Path.Combine(Dir,"active.json"),true);File.Copy(manifest,Path.Combine(pending,"applied.json"),true);File.Delete(manifest);Log("Applied verified startup update");}
  catch{foreach(var name in names){string backup=Path.Combine(pending,Path.GetFileName(name)+".previous");if(File.Exists(backup))File.Copy(backup,Path.Combine(App,name),true);}File.WriteAllBytes(Path.Combine(Dir,"active.json"),oldActive);throw;}
 }
 // A queued Dots build waits in desktop-features/staging until Codex is closed. Restarting Codex from the shortcut leaves
 // no gap for the background watcher, so the launcher applies the queued build itself before it opens the window.
 static void ApplyStaged(){
  string staging=Path.Combine(Dir,"staging");
  if(!Directory.Exists(staging)||LiveWindow())return;
  for(int i=0;i<150&&ManagedProcess();i++)Thread.Sleep(100);
  if(ManagedProcess()){Log("Staged build deferred: managed process still running");return;}
  string repo=Path.GetFullPath(Path.Combine(Root,"..","..",".."));
  string script=Path.Combine(repo,"scripts","apply-pending-features.mjs");
  if(!File.Exists(script))return;
  try{
   var info=new ProcessStartInfo("node","\""+script+"\" --now"){UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=repo};
   using(var p=Process.Start(info)){
    if(!p.WaitForExit(300000)){Log("Staged build apply timed out");return;}
    Log("Staged build apply exit="+p.ExitCode);
   }
  }catch(Exception ex){Log("Staged build apply skipped: "+ex.Message);}
 }
 static string StripExe(string commandLine){
  if(string.IsNullOrEmpty(commandLine))return "";
  int i=0,n=commandLine.Length;
  while(i<n&&(commandLine[i]==' '||commandLine[i]=='\t'))i++;
  if(i>=n)return "";
  if(commandLine[i]=='"'){i++;while(i<n&&commandLine[i]!='"')i++;if(i<n)i++;}
  else{while(i<n&&commandLine[i]!=' '&&commandLine[i]!='\t')i++;}
  while(i<n&&(commandLine[i]==' '||commandLine[i]=='\t'))i++;
  return i<n?commandLine.Substring(i):"";
 }
 static bool ConsumeFlag(ref string rest,string flag){
  if(!rest.StartsWith(flag,StringComparison.Ordinal))return false;
  if(rest.Length>flag.Length&&rest[flag.Length]!=' '&&rest[flag.Length]!='\t')return false;
  int i=flag.Length;while(i<rest.Length&&(rest[i]==' '||rest[i]=='\t'))i++;
  rest=rest.Substring(i);return true;
 }
 static string ParseLaunchArgs(string commandLine,out bool checkOnly,out bool managedOnly){
  checkOnly=false;managedOnly=false;
  string rest=StripExe(commandLine);
  while(rest.Length>0){
   if(ConsumeFlag(ref rest,"--check-only")){checkOnly=true;continue;}
   if(ConsumeFlag(ref rest,"--managed")){managedOnly=true;continue;}
   if(ConsumeFlag(ref rest,"--"))break;
   break;
  }
  return rest;
 }
 static ProcessStartInfo StartInfo(string exe,string forwardArgs){
  var info=new ProcessStartInfo(exe){UseShellExecute=false,WorkingDirectory=App};
  if(!string.IsNullOrEmpty(forwardArgs))info.Arguments=forwardArgs;
  var file=Path.Combine(Root,"environment.json");
  if(File.Exists(file)){var env=Json(file);foreach(var pair in (Dictionary<string,object>)env["environment"])info.EnvironmentVariables[pair.Key]=Convert.ToString(pair.Value);}
  return info;
 }
 static string InstalledPackageVersion(){
  try{
   uint count=0,bufLen=0;
   int rc=GetPackagesByPackageFamily(PackageFamily,ref count,null,ref bufLen,null);
   if(rc==0&&count==0)return "";
   if(rc==122&&count>0){
    var names=new IntPtr[count];var buf=new char[bufLen];
    if(GetPackagesByPackageFamily(PackageFamily,ref count,names,ref bufLen,buf)==0&&count>0){
     string full=Marshal.PtrToStringUni(names[0]);
     if(!string.IsNullOrEmpty(full)){string[] parts=full.Split('_');if(parts.Length>=2)return parts[1];}
    }
   }
  }catch{}
  var query=new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0","powershell.exe"),"-NoProfile -NonInteractive -Command \"(Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1).Version.ToString()\""){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true};
  using(var process=Process.Start(query)){string version=process.StandardOutput.ReadToEnd().Trim();if(!process.WaitForExit(5000)||process.ExitCode!=0)return "";return version;}
 }
 static bool Ready(){
  string alive=Path.Combine(Dir,"heartbeat"),active=Path.Combine(Dir,"active.json");
  if(!File.Exists(alive)||(DateTime.UtcNow-File.GetLastWriteTimeUtc(alive)).TotalSeconds>20||!File.Exists(active))return false;
  var data=Json(active);string exe=Path.Combine(App,"ChatGPT.exe");
  if(InstalledPackageVersion()!=(string)data["packageVersion"])return false;
  return String.Equals(Path.GetFullPath((string)data["exe"]),exe,StringComparison.OrdinalIgnoreCase)&&File.Exists(exe)&&Hash(exe)==(string)data["exeHash"];
 }
 // Dots services create services.lock while they start. A shortcut clicked during that window waits briefly instead of opening the unmanaged Codex.
 static bool DotsStarting(){
  try{
   string lockDir=Path.Combine(Path.GetDirectoryName(Root.TrimEnd(Path.DirectorySeparatorChar)),"services.lock");
   return Directory.Exists(lockDir)&&(DateTime.UtcNow-Directory.GetLastWriteTimeUtc(lockDir)).TotalSeconds<120;
  }catch{return false;}
 }
 static bool WaitForDots(){
  if(!DotsStarting())return false;
  Log("Dots services are starting; waiting for the managed Codex to become ready");
  for(int i=0;i<60;i++){if(Ready())return true;Thread.Sleep(500);}
  Log("Dots services did not become ready in time");
  return false;
 }
 // Codex 26.1027+ keeps window storage in %APPDATA%\Codex\web. The package container redirects that to the package profile;
 // the managed copy runs outside the container, so link the folder to the same profile while no managed window is open.
 static void LinkPackageProfile(){
  try{
   string web=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),"Codex","web");
   string pkg=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Packages","OpenAI.Codex_2p2nqsd0c76g0","LocalCache","Roaming","Codex","web");
   if(!Directory.Exists(pkg)||ManagedProcess())return;
   var info=new DirectoryInfo(web);
   if(info.Exists&&(info.Attributes&FileAttributes.ReparsePoint)!=0)return;
   Directory.CreateDirectory(Path.GetDirectoryName(web));
   if(info.Exists){string aside=web+".damndots-"+DateTime.Now.ToString("yyyyMMdd-HHmmss");Directory.Move(web,aside);Log("Moved separate managed profile to "+aside);}
   var mk=new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"cmd.exe"),"/d /c mklink /J \""+web+"\" \""+pkg+"\""){UseShellExecute=false,CreateNoWindow=true};
   using(var p=Process.Start(mk)){p.WaitForExit(10000);Log("Linked managed profile to package profile exit="+p.ExitCode);}
  }catch(Exception ex){Log("profile link skipped: "+ex.Message);}
 }
 [STAThread] public static int Main(string[] args){
  try{
   SetCurrentProcessExplicitAppUserModelID(AppId);
   bool checkOnly,managedOnly;
   string forwardArgs=ParseLaunchArgs(Environment.CommandLine,out checkOnly,out managedOnly);
   if(checkOnly){bool ready=Ready();Log("check managed-ready="+ready+" pending="+File.Exists(Path.Combine(Dir,"startup-update","active.json")));return ready?0:2;}
   using(var gate=new Mutex(false,"Local\\DamndotsDesktopLaunch")){
    if(!gate.WaitOne(15000))return 3;
    try{
     if(File.Exists(Path.Combine(Dir,"startup-update","active.json"))&&!LiveWindow())for(int i=0;i<20&&ManagedProcess();i++)Thread.Sleep(100);
     ApplyPending();
     ApplyStaged();
     LinkPackageProfile();
     if(!Ready()){
      if(managedOnly)return 4;
      if(!WaitForDots()){Original(forwardArgs);return 0;}
     }
     bool sawManaged=ManagedProcess();
     for(int attempt=0;attempt<3;attempt++){
      bool hadManagedBefore=ManagedProcess();
      using(var child=Process.Start(StartInfo(Path.Combine(App,"ChatGPT.exe"),forwardArgs))){
       if(child==null)throw new Exception("Desktop process not created");
       Log("launch pid="+child.Id+" attempt="+attempt+(string.IsNullOrEmpty(forwardArgs)?"":" args=forwarded"));
       if(!child.WaitForExit(1800))return 0;
       if(child.ExitCode!=0){Log("Desktop exit="+child.ExitCode);return child.ExitCode;}
      }
      // A closing instance can still own Electron's singleton lock while draining.
      // Wait for either a live window to accept the launch or the closing managed process to finish exiting.
      bool sawAfter=false;
      int waitSteps=(hadManagedBefore||sawManaged)?120:8;
      for(int i=0;i<waitSteps;i++){
       if(LiveWindow()){Log("Existing window accepted launch");return 0;}
       bool running=ManagedProcess();
       if(running){sawAfter=true;if(waitSteps<120)waitSteps=120;}
       else if(sawAfter||hadManagedBefore){Log("Closing managed process exited; retrying launch");break;}
       Thread.Sleep(100);
      }
      if(!sawAfter&&!hadManagedBefore&&attempt>=1)break;
     }
     Log("No live window after retries");return 5;
    }finally{gate.ReleaseMutex();}
   }
  }catch(Exception ex){Log("error="+ex.Message);return 1;}
 }
}
