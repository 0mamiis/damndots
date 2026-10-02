# Açık Codex ana penceresini bulur. QueryOnly salt okunurdur; normal çağrı aynı pencereyi öne getirir.
param([switch]$QueryOnly,[switch]$OriginalOnly)
$ErrorActionPreference='Stop'
Add-Type @"
using System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;
public class DotsFocus{
 public delegate bool EnumProc(IntPtr h,IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p,IntPtr l);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h,int i);
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h,int n);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 public static IntPtr Find(uint[] pids){IntPtr found=IntPtr.Zero;EnumWindows((h,x)=>{if(!IsWindowVisible(h)||(GetWindowLong(h,-20)&0x80)!=0)return true;uint p;GetWindowThreadProcessId(h,out p);if(Array.IndexOf(pids,p)<0)return true;found=h;return false;},IntPtr.Zero);return found;}
}
"@
$ids=@(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Where-Object { -not $OriginalOnly -or $_.Path -like '*\WindowsApps\OpenAI.Codex_*\app\ChatGPT.exe' } | ForEach-Object { [uint32]$_.Id })
$window=[DotsFocus]::Find([uint32[]]$ids)
if($window -ne [IntPtr]::Zero){
  Write-Output 'CODEX_OPEN=1'
  if(-not $QueryOnly){[DotsFocus]::ShowWindowAsync($window,9)|Out-Null;[DotsFocus]::SetForegroundWindow($window)|Out-Null}
}else{Write-Output 'CODEX_OPEN=0'}
