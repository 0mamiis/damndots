# Remove only the selected relay, its own SSH child and its startup registration. Tokens/config are kept.
param(
 [ValidateSet('Main','Local')][string]$Role,
 [string]$Directory,
 [string]$TaskName='DotsCodexBridge'
)
$ErrorActionPreference='Stop'
if(-not $Role){throw 'Specify -Role Main or -Role Local.'}
if(-not $Directory){$Directory=if($Role -eq 'Main'){Join-Path $env:ProgramData 'DotsCodexBridge'}else{Join-Path $env:USERPROFILE '.codex\dots-local-bridge'}}
$Directory=[IO.Path]::GetFullPath($Directory)
$script=Join-Path $Directory $(if($Role -eq 'Main'){'relay.cjs'}else{'bridge.cjs'})
if($Role -eq 'Main'){
 $task=Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
 if($task){
  if(-not($task.Actions|Where-Object {$_.Arguments -like ('*'+$script+'*')})){throw 'The scheduled task does not belong to this bridge directory.'}
  Stop-ScheduledTask -TaskName $TaskName
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
 }
}else{
 $startup=Join-Path ([Environment]::GetFolderPath('Startup')) 'Dots-Local-Codex-Bridge.vbs'
 if(Test-Path -LiteralPath $startup){
  if(-not([IO.File]::ReadAllText($startup).Contains($script))){throw 'Startup entry belongs to another bridge directory.'}
  Remove-Item -LiteralPath $startup
 }
}
$targets=Get-CimInstance Win32_Process|Where-Object {$_.Name -eq 'node.exe' -and $_.CommandLine -match [regex]::Escape($script)}
foreach($target in $targets){
 $children=Get-CimInstance Win32_Process|Where-Object {$_.ParentProcessId -eq $target.ProcessId -and $_.Name -eq 'ssh.exe'}
 foreach($child in $children){Stop-Process -Id $child.ProcessId -Force}
 Stop-Process -Id $target.ProcessId -Force
}
"Bridge startup removed. Private token and configuration preserved in $Directory."
