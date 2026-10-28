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
 [ComImport,Guid("2e941141-7f97-4756-ba1d-9decde894a3d"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]interface Activation {
  [PreserveSig]int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)]string id,[MarshalAs(UnmanagedType.LPWStr)]string args,uint options,out uint pid);
 }
 static void Original(){var activation=(Activation)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")));try{uint pid;Marshal.ThrowExceptionForHR(activation.ActivateApplication(AppId,null,0,out pid));}finally{Marshal.ReleaseComObject(activation);}}
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
 static ProcessStartInfo StartInfo(string exe){
  var info=new ProcessStartInfo(exe){UseShellExecute=false,WorkingDirectory=App};
  var file=Path.Combine(Root,"environment.json");
  if(File.Exists(file)){var env=Json(file);foreach(var pair in (Dictionary<string,object>)env["environment"])info.EnvironmentVariables[pair.Key]=Convert.ToString(pair.Value);}
  return info;
 }
 static bool Ready(){
  string alive=Path.Combine(Dir,"heartbeat"),active=Path.Combine(Dir,"active.json");
  if(!File.Exists(alive)||(DateTime.UtcNow-File.GetLastWriteTimeUtc(alive)).TotalSeconds>20||!File.Exists(active))return false;
  var data=Json(active);string exe=Path.Combine(App,"ChatGPT.exe");
  var query=new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0","powershell.exe"),"-NoProfile -NonInteractive -Command \"(Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1).Version.ToString()\""){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true};
  using(var process=Process.Start(query)){string version=process.StandardOutput.ReadToEnd().Trim();if(!process.WaitForExit(5000)||process.ExitCode!=0||version!=(string)data["packageVersion"])return false;}
  return String.Equals(Path.GetFullPath((string)data["exe"]),exe,StringComparison.OrdinalIgnoreCase)&&File.Exists(exe)&&Hash(exe)==(string)data["exeHash"];
 }
 [STAThread] public static int Main(string[] args){
  try{
   SetCurrentProcessExplicitAppUserModelID(AppId);
   if(args.Length>0&&args[0]=="--check-only"){bool ready=Ready();Log("check managed-ready="+ready+" pending="+File.Exists(Path.Combine(Dir,"startup-update","active.json")));return ready?0:2;}
   using(var gate=new Mutex(false,"Local\\DamndotsDesktopLaunch")){
    if(!gate.WaitOne(15000))return 3;
    try{
     if(File.Exists(Path.Combine(Dir,"startup-update","active.json"))&&!LiveWindow())for(int i=0;i<20&&ManagedProcess();i++)Thread.Sleep(100);
     ApplyPending();
     if(!Ready()){
      if(args.Length>0&&args[0]=="--managed")return 4;
      Original();return 0;
     }
     for(int attempt=0;attempt<2;attempt++){
      using(var child=Process.Start(StartInfo(Path.Combine(App,"ChatGPT.exe")))){
       if(child==null)throw new Exception("Desktop process not created");
       Log("launch pid="+child.Id+" attempt="+attempt);
       if(!child.WaitForExit(1800))return 0;
       if(child.ExitCode!=0){Log("Desktop exit="+child.ExitCode);return child.ExitCode;}
      }
      // A closing instance can still own Electron's singleton lock. Retry only if no live window accepted the launch.
      for(int i=0;i<8;i++){if(LiveWindow()){Log("Existing window accepted launch");return 0;}Thread.Sleep(125);}
     }
     Log("No live window after two launches");return 5;
    }finally{gate.ReleaseMutex();}
   }
  }catch(Exception ex){Log("error="+ex.Message);return 1;}
 }
}
