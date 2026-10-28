using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

[StructLayout(LayoutKind.Sequential)]
struct PropertyKey {
 public Guid Format; public uint Id;
 public PropertyKey(uint id) { Format=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"); Id=id; }
}
[StructLayout(LayoutKind.Explicit, Size=24)]
struct PropVariant {
 [FieldOffset(0)] public ushort Type;
 [FieldOffset(8)] public IntPtr Pointer;
 public static PropVariant Text(string value) { return new PropVariant{ Type=31, Pointer=Marshal.StringToCoTaskMemUni(value) }; }
 public string Read() { return Type==31 && Pointer!=IntPtr.Zero ? Marshal.PtrToStringUni(Pointer) : ""; }
}
[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface PropertyStore {
 [PreserveSig] int GetCount(out uint count);
 [PreserveSig] int GetAt(uint index,out PropertyKey key);
 [PreserveSig] int GetValue(ref PropertyKey key,out PropVariant value);
 [PreserveSig] int SetValue(ref PropertyKey key,ref PropVariant value);
 [PreserveSig] int Commit();
}
public class DotsTaskbarIdentity {
 const string AppId="OpenAI.Codex_2p2nqsd0c76g0!App";
 static readonly string Root=AppDomain.CurrentDomain.BaseDirectory;
 static readonly string Target=Path.Combine(Root,"desktop-features","app","ChatGPT.exe");
 static readonly string Alive=Path.Combine(Root,"desktop-features","heartbeat");
 static readonly Guid StoreId=new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
 delegate bool EnumCallback(IntPtr window,IntPtr param);
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumCallback callback,IntPtr param);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
 [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window,uint command);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
 [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr window,ref Guid guid,[MarshalAs(UnmanagedType.Interface)]out PropertyStore store);
 [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);
 static string Read(PropertyStore store,uint id) {
  PropertyKey key=new PropertyKey(id); PropVariant value;
  Marshal.ThrowExceptionForHR(store.GetValue(ref key,out value));
  try { return value.Read(); } finally { PropVariantClear(ref value); }
 }
 static void Set(PropertyStore store,uint id,string text) {
  PropertyKey key=new PropertyKey(id); PropVariant value=PropVariant.Text(text);
  try { Marshal.ThrowExceptionForHR(store.SetValue(ref key,ref value)); } finally { PropVariantClear(ref value); }
 }
 static void Log(string message) {
  Console.WriteLine(message);
  try { File.AppendAllText(Path.Combine(Root,"taskbar-identity.log"),DateTime.Now.ToString("s")+" "+message+Environment.NewLine); } catch {}
 }
 static void Windows(bool apply) {
  EnumWindows(delegate(IntPtr window,IntPtr param) {
   uint pid; GetWindowThreadProcessId(window,out pid);
   if(!IsWindowVisible(window) || GetWindow(window,4)!=IntPtr.Zero)return true;
   try {
    using(Process process=Process.GetProcessById((int)pid)) {
     if(process.ProcessName!="ChatGPT")return true;
     if(!String.Equals(process.MainModule.FileName,Target,StringComparison.OrdinalIgnoreCase))return true;
    }
    Guid guid=StoreId; PropertyStore store;
    Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(window,ref guid,out store));
    try {
     string previous=Read(store,5);
     if(!apply) Console.WriteLine("window="+window+" pid="+pid+" appId=["+previous+"] icon=["+Read(store,3)+"] relaunch=["+Read(store,2)+"]");
     else if(previous!=AppId) {
      // Set relaunch metadata before the ID so the shell receives the complete identity at refresh.
      Set(store,2,"\""+Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows),"explorer.exe")+"\" shell:AppsFolder\\"+AppId);
      Set(store,3,Path.Combine(Root,"codex.ico")+",0");
      Set(store,4,"ChatGPT");
      Set(store,5,AppId);
      string actual=Read(store,5);
      if(actual!=AppId)throw new Exception("Window identity verification failed");
      Log("window="+window+" pid="+pid+" previous=["+previous+"] appId=["+actual+"]");
     }
    } finally { Marshal.ReleaseComObject(store); }
   } catch(Exception ex) { if(apply) Log("window="+window+" error="+ex.Message); }
   return true;
  },IntPtr.Zero);
 }
 [STAThread]
 public static int Main(string[] args) {
  try {
   string mode=args.Length==0?"inspect":args[0];
   if(mode=="inspect"){Windows(false);return 0;}
   if(mode=="apply"){Windows(true);return 0;}
   if(mode=="watch"){
    bool created; using(Mutex mutex=new Mutex(true,"Local\\DamndotsTaskbarIdentity",out created)){
     if(!created)return 0;
     try {
      while(File.Exists(Alive) && DateTime.UtcNow-File.GetLastWriteTimeUtc(Alive)<TimeSpan.FromSeconds(20)) {
       Windows(true); Thread.Sleep(1500);
      }
     } finally {mutex.ReleaseMutex();}
    }
    return 0;
   }
   return 2;
  } catch(Exception ex){Log("error="+ex.Message);return 1;}
 }
}

