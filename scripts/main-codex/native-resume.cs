using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

// Package processes start suspended, before their managed MainModule can be inspected.
// Query package identity in the kernel; resume only a thread belonging to that Codex package.
//
// Optional patched-Codex redirect: when %USERPROFILE%\CodexPatched\patched-codex.json exists and its
// packageVersion matches the installed Codex package, the suspended original is replaced by the patched
// copy (same environment from environment.json next to this helper) while the patched proxy window is open
// (it refreshes %USERPROFILE%\CodexPatched\proxy-alive every few seconds). Any problem, or a stale heartbeat,
// falls back to the normal resume. Creating %USERPROFILE%\CodexPatched\devre-disi turns the redirect off.
public static class DotsNativeResume {
 [DllImport("kernel32.dll",SetLastError=true)]static extern IntPtr OpenThread(uint access,bool inherit,uint id);
 [DllImport("kernel32.dll",SetLastError=true)]static extern uint GetProcessIdOfThread(IntPtr thread);
 [DllImport("kernel32.dll",SetLastError=true)]static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll",SetLastError=true)]static extern IntPtr OpenProcess(uint access,bool inherit,uint id);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool TerminateProcess(IntPtr process,uint code);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern int GetPackageFullName(IntPtr process,ref uint length,StringBuilder name);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool QueryFullProcessImageName(IntPtr process,uint flags,StringBuilder name,ref uint size);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
 static string Mode="original";
 public static string PackageName(uint pid){
  IntPtr process=OpenProcess(0x1000,false,pid);if(process==IntPtr.Zero)return null;
  try{uint size=0;int status=GetPackageFullName(process,ref size,null);if(status!=122)return null;
   var name=new StringBuilder((int)size);return GetPackageFullName(process,ref size,name)==0?name.ToString():null;
  }finally{CloseHandle(process);}
 }
 public static string ImageName(uint pid){
  IntPtr process=OpenProcess(0x1000,false,pid);if(process==IntPtr.Zero)return null;
  try{uint size=32768;var name=new StringBuilder((int)size);return QueryFullProcessImageName(process,0,name,ref size)?name.ToString():null;}finally{CloseHandle(process);}
 }
 static string Unescape(string value){
  return Regex.Replace(value,@"\\(u[0-9a-fA-F]{4}|.)",delegate(Match m){
   string code=m.Groups[1].Value;
   if(code.Length==5)return ((char)Convert.ToInt32(code.Substring(1),16)).ToString();
   switch(code){case "n":return "\n";case "r":return "\r";case "t":return "\t";default:return code;}
  });
 }
 static Dictionary<string,string> ReadPairs(string json){
  var values=new Dictionary<string,string>(StringComparer.Ordinal);
  foreach(Match m in Regex.Matches(json,"\"((?:\\\\.|[^\"\\\\])*)\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\""))values[Unescape(m.Groups[1].Value)]=Unescape(m.Groups[2].Value);
  return values;
 }
 // Returns true only when the patched copy was started and the suspended original was terminated.
 static bool ApplyPermissionUpdate(string home){
  string manifest=Path.Combine(home,"permission-update","manifest.json");
  if(!File.Exists(manifest))return true;
  string script=Path.Combine(home,"tools","apply-permission-update.ps1");
  if(!File.Exists(script))return false;
  var start=new System.Diagnostics.ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0","powershell.exe"));
  start.Arguments="-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \""+script+"\"";
  start.UseShellExecute=false;start.CreateNoWindow=true;
  using(var installer=System.Diagnostics.Process.Start(start)){
   return installer!=null&&installer.WaitForExit(30000)&&installer.ExitCode==0;
  }
 }
 static bool TryManagedRedirect(uint pid,string package,string directory){
  try{
   string heartbeat=Path.Combine(directory,"heartbeat");
   if(!File.Exists(heartbeat)||(DateTime.UtcNow-File.GetLastWriteTimeUtc(heartbeat)).TotalSeconds>20)return false;
   string active=Path.Combine(directory,"active.json");
   if(!File.Exists(active))return false;
   var config=ReadPairs(File.ReadAllText(active));string exe,version,expectedHash;
   if(!config.TryGetValue("exe",out exe)||!config.TryGetValue("packageVersion",out version)||!config.TryGetValue("exeHash",out expectedHash))return false;
   string expected=Path.GetFullPath(Path.Combine(directory,"app","ChatGPT.exe"));
   if(!String.Equals(Path.GetFullPath(exe),expected,StringComparison.OrdinalIgnoreCase)||!File.Exists(exe))return false;
   string[] parts=package.Split('_');if(parts.Length<2||parts[1]!=version)return false;
   using(var sha=System.Security.Cryptography.SHA256.Create())using(var stream=File.OpenRead(exe)){
    string actual=BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();if(actual!=expectedHash)return false;
   }
   string launcher=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"desktop-launcher.exe");
   var start=new System.Diagnostics.ProcessStartInfo(File.Exists(launcher)?launcher:exe){UseShellExecute=false,WorkingDirectory=Path.GetDirectoryName(exe)};
   if(File.Exists(launcher))start.Arguments="--managed";
   string file=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"environment.json");
   if(File.Exists(file)){string json=File.ReadAllText(file);int at=json.IndexOf("\"environment\"",StringComparison.Ordinal);if(at>=0)foreach(var pair in ReadPairs(json.Substring(at+13)))start.EnvironmentVariables[pair.Key]=pair.Value;}
   if(System.Diagnostics.Process.Start(start)==null)return false;
   IntPtr original=OpenProcess(1,false,pid);if(original!=IntPtr.Zero){try{TerminateProcess(original,0);}finally{CloseHandle(original);}}
   Mode="damndots-managed";return true;
  }catch{return false;}
 }
 static bool TryRedirect(uint pid,string package){
  try{
   string managed=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"desktop-features");
   if(Directory.Exists(managed))return TryManagedRedirect(pid,package,managed);
   string home=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),"CodexPatched");
   string config=Path.Combine(home,"patched-codex.json");
   if(!File.Exists(config)||File.Exists(Path.Combine(home,"devre-disi")))return false;
   string alive=Path.Combine(home,"proxy-alive");
   if(!File.Exists(alive)||(DateTime.UtcNow-File.GetLastWriteTimeUtc(alive)).TotalSeconds>20)return false;
   var settings=ReadPairs(File.ReadAllText(config));
   string exe,version;
   if(!settings.TryGetValue("exe",out exe)||!File.Exists(exe)||!settings.TryGetValue("packageVersion",out version))return false;
   string[] parts=package.Split('_');
   if(parts.Length<2||parts[1]!=version)return false;
   if(!ApplyPermissionUpdate(home))return false;
   var start=new System.Diagnostics.ProcessStartInfo(exe);
   start.UseShellExecute=false;
   start.WorkingDirectory=Path.GetDirectoryName(exe);
   string environmentFile=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"environment.json");
   if(File.Exists(environmentFile)){
    string json=File.ReadAllText(environmentFile);
    int at=json.IndexOf("\"environment\"",StringComparison.Ordinal);
    if(at>=0)foreach(var pair in ReadPairs(json.Substring(at+13)))start.EnvironmentVariables[pair.Key]=pair.Value;
   }
   if(System.Diagnostics.Process.Start(start)==null)return false;
   IntPtr original=OpenProcess(1,false,pid);
   if(original!=IntPtr.Zero){try{TerminateProcess(original,0);}finally{CloseHandle(original);}}
   Mode="patched";
   return true;
  }catch{return false;}
 }
 public static int Resume(uint pid,uint tid){
  IntPtr thread=OpenThread(2|0x800,false,tid);if(thread==IntPtr.Zero)return 3;
  try{
   if(GetProcessIdOfThread(thread)!=pid)return 4;
   string package=PackageName(pid);if(package==null||!package.StartsWith("OpenAI.Codex_",StringComparison.Ordinal))return 5;
   if(TryRedirect(pid,package))return 0;
   return ResumeThread(thread)==uint.MaxValue?6:0;
  }finally{CloseHandle(thread);}
 }
 public static int Main(string[] args){
  uint pid=0,tid=0;
  for(int i=0;i+1<args.Length;i++){if(args[i]=="-p")uint.TryParse(args[++i],out pid);else if(args[i]=="-tid")uint.TryParse(args[++i],out tid);}
  int result=pid==0||tid==0?2:Resume(pid,tid);
  try{File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"native-resume.log"),DateTime.UtcNow.ToString("o")+" pid="+pid+" tid="+tid+" result="+result+" mode="+Mode+Environment.NewLine);}catch{}
  return result;
 }
}
