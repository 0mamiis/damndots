param([switch]$CleanIncompleteActivations)
$ErrorActionPreference='Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
[ComImport,Guid("F27C3930-8029-4AD1-94E3-3DBA417810C1"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDotsDisablePackage {
 [PreserveSig]int EnableDebugging([MarshalAs(UnmanagedType.LPWStr)]string n,[MarshalAs(UnmanagedType.LPWStr)]string d,IntPtr e);
 [PreserveSig]int DisableDebugging([MarshalAs(UnmanagedType.LPWStr)]string n);
}
public static class DotsDisablePackage {
 public static int Disable(string name){var s=(IDotsDisablePackage)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("B1AEC16F-2383-4852-B0E9-8F0B1DC66B4D")));try{return s.DisableDebugging(name);}finally{Marshal.FinalReleaseComObject(s);}}
}
"@
$package=Get-AppxPackage -Name OpenAI.Codex|Select-Object -First 1
$hr=[DotsDisablePackage]::Disable($package.PackageFullName)
Write-Output ('Old activation registration disabled: 0x'+$hr.ToString('X8'))
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'native-resume.cs')))
if(-not $CleanIncompleteActivations){return}
foreach($candidate in (Get-Process -Name ChatGPT -ErrorAction SilentlyContinue)){
 if([DotsNativeResume]::PackageName([uint32]$candidate.Id) -ne $package.PackageFullName){continue}
 if($candidate.MainWindowHandle -ne [IntPtr]::Zero){continue}
 $threads=@($candidate.Threads)
 if($threads.Count -eq 1 -and $threads[0].ThreadState -eq 'Wait' -and $threads[0].WaitReason -eq 'Suspended'){
  Stop-Process -Id $candidate.Id
  Write-Output ('Stopped incomplete original activation '+$candidate.Id)
 }
}
