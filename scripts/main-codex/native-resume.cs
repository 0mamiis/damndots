using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

// Package processes start suspended, before their managed MainModule can be inspected.
// Query package identity in the kernel; resume only a thread belonging to that Codex package.
public static class DotsNativeResume {
 [DllImport("kernel32.dll",SetLastError=true)]static extern IntPtr OpenThread(uint access,bool inherit,uint id);
 [DllImport("kernel32.dll",SetLastError=true)]static extern uint GetProcessIdOfThread(IntPtr thread);
 [DllImport("kernel32.dll",SetLastError=true)]static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll",SetLastError=true)]static extern IntPtr OpenProcess(uint access,bool inherit,uint id);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern int GetPackageFullName(IntPtr process,ref uint length,StringBuilder name);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool QueryFullProcessImageName(IntPtr process,uint flags,StringBuilder name,ref uint size);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
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
 public static int Resume(uint pid,uint tid){
  IntPtr thread=OpenThread(2|0x800,false,tid);if(thread==IntPtr.Zero)return 3;
  try{
   if(GetProcessIdOfThread(thread)!=pid)return 4;
   string package=PackageName(pid);if(package==null||!package.StartsWith("OpenAI.Codex_",StringComparison.Ordinal))return 5;
   return ResumeThread(thread)==uint.MaxValue?6:0;
  }finally{CloseHandle(thread);}
 }
 public static int Main(string[] args){
  uint pid=0,tid=0;
  for(int i=0;i+1<args.Length;i++){if(args[i]=="-p")uint.TryParse(args[++i],out pid);else if(args[i]=="-tid")uint.TryParse(args[++i],out tid);}
  int result=pid==0||tid==0?2:Resume(pid,tid);
  try{File.AppendAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"native-resume.log"),DateTime.UtcNow.ToString("o")+" pid="+pid+" tid="+tid+" result="+result+Environment.NewLine);}catch{}
  return result;
 }
}
