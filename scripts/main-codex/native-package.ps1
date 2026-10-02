param(
 [Parameter(Mandatory=$true)][string]$EnvironmentFile,
 [Parameter(Mandatory=$true)][int]$ParentPid,
 [switch]$CheckOnly
)
$ErrorActionPreference='Stop'
$inputState=Get-Content -LiteralPath $EnvironmentFile -Raw|ConvertFrom-Json
$data=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($EnvironmentFile))
$helper=Join-Path $data 'native-resume.exe'
$source=Join-Path $PSScriptRoot 'native-resume.cs'
$stopFile=Join-Path $data 'package-stop'
Remove-Item -LiteralPath $stopFile -ErrorAction SilentlyContinue
$sourceHash=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
$hashFile=Join-Path $data 'native-resume.source-hash'
if(-not(Test-Path -LiteralPath $helper) -or -not(Test-Path -LiteralPath $hashFile) -or (Get-Content -LiteralPath $hashFile -Raw).Trim() -ne $sourceHash){
 if(Test-Path -LiteralPath $helper){Remove-Item -LiteralPath $helper}
 Add-Type -TypeDefinition ([IO.File]::ReadAllText($source)) -OutputAssembly $helper -OutputType WindowsApplication
 [IO.File]::WriteAllText($hashFile,$sourceHash)
}
Add-Type @"
using System;
using System.Runtime.InteropServices;
[ComImport,Guid("F27C3930-8029-4AD1-94E3-3DBA417810C1"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDotsPackageDebugSettings {
 [PreserveSig]int EnableDebugging([MarshalAs(UnmanagedType.LPWStr)]string packageName,[MarshalAs(UnmanagedType.LPWStr)]string debuggerCommandLine,IntPtr environment);
 [PreserveSig]int DisableDebugging([MarshalAs(UnmanagedType.LPWStr)]string packageName);
}
public class DotsPackageEnvironment:IDisposable {
 IDotsPackageDebugSettings settings;
 public DotsPackageEnvironment(){settings=(IDotsPackageDebugSettings)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("B1AEC16F-2383-4852-B0E9-8F0B1DC66B4D")));}
 public int Enable(string name,string helper,string[] variables){IntPtr p=Marshal.StringToHGlobalUni(string.Join("\0",variables)+"\0\0");try{return settings.EnableDebugging(name,"\""+helper+"\"",p);}finally{Marshal.FreeHGlobal(p);}}
 public int Disable(string name){return settings.DisableDebugging(name);}
 public void Dispose(){if(settings!=null){Marshal.FinalReleaseComObject(settings);settings=null;}}
}
"@
$settings=New-Object DotsPackageEnvironment
$cliSource=Join-Path $PSScriptRoot 'native-cli-launcher.cs'
$cliExe=Join-Path $data 'native-cli.exe'
$cliHash=(Get-FileHash -LiteralPath $cliSource -Algorithm SHA256).Hash
$cliHashFile=Join-Path $data 'native-cli.source-hash'
if(-not(Test-Path -LiteralPath $cliExe) -or -not(Test-Path -LiteralPath $cliHashFile) -or (Get-Content -LiteralPath $cliHashFile -Raw).Trim() -ne $cliHash){
 if(Test-Path -LiteralPath $cliExe){Remove-Item -LiteralPath $cliExe}
 Add-Type -TypeDefinition ([IO.File]::ReadAllText($cliSource)) -OutputAssembly $cliExe -OutputType ConsoleApplication -ReferencedAssemblies @('System.Web.Extensions.dll','System.dll')
 [IO.File]::WriteAllText($cliHashFile,$cliHash)
}
$enabled=$null
try{
 do{
  $package=Get-AppxPackage -Name OpenAI.Codex|Select-Object -First 1
  if(-not $package){throw 'Kurulu Codex paketi bulunamadi.'}
  if($enabled -ne $package.PackageFullName){
   if($enabled){[void]$settings.Disable($enabled)}
   $vars=@($inputState.environment.PSObject.Properties|ForEach-Object{$_.Name+'='+[string]$_.Value})
   $hr=$settings.Enable($package.PackageFullName,$helper,$vars)
   if($hr -lt 0){throw ('Orijinal Codex baglantisi kurulamadi: 0x'+$hr.ToString('X8'))}
   $enabled=$package.PackageFullName
   [IO.File]::WriteAllText((Join-Path $data 'package-ready.json'),(@{package=$enabled;pid=$PID;updatedAt=(Get-Date).ToUniversalTime().ToString('o')}|ConvertTo-Json))
   Write-Output ('Orijinal Codex acilisi Dots proxy ayarlariyla hazir: '+$enabled)
  }
  if($CheckOnly){break}
  Start-Sleep -Seconds 2
 }while((Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) -and -not(Test-Path -LiteralPath $stopFile))
}finally{
 if($enabled){[void]$settings.Disable($enabled)}
 $settings.Dispose()
 Remove-Item -LiteralPath (Join-Path $data 'package-ready.json') -ErrorAction SilentlyContinue
 Remove-Item -LiteralPath $stopFile -ErrorAction SilentlyContinue
}
