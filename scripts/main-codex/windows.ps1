# Codex (ChatGPT.exe) süreçlerine ait görünür üst düzey pencereleri listeler: TÜR|pid|başlık|GxY
# TÜR: ORIGINAL = kurulu MSIX Codex, DOTS = Dots kopyası. Teşhis amaçlıdır; hiçbir şeyi değiştirmez.
Add-Type @"
using System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;
public class DotsWin{
 public delegate bool EnumProc(IntPtr h,IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p,IntPtr l);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out RECT r);
 [StructLayout(LayoutKind.Sequential)] public struct RECT{public int L,T,R,B;}
 public static List<string> All(){var l=new List<string>();EnumWindows((h,x)=>{if(!IsWindowVisible(h))return true;uint pid;GetWindowThreadProcessId(h,out pid);var s=new StringBuilder(256);GetWindowText(h,s,256);RECT r;GetWindowRect(h,out r);l.Add(pid+"|"+s+"|"+(r.R-r.L)+"x"+(r.B-r.T));return true;},IntPtr.Zero);return l;}
}
"@
$procs = @{}
Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" | ForEach-Object { $procs[[string]$_.ProcessId] = $_.ExecutablePath }
foreach ($line in [DotsWin]::All()) {
  $owner = $line.Split('|')[0]
  if ($procs.ContainsKey($owner)) { $kind = if ($procs[$owner] -like '*WindowsApps*') { 'ORIGINAL' } else { 'DOTS' }; $kind + '|' + $line }
}
