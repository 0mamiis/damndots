# Install a token-protected loopback relay to an existing Codex app-server daemon. Run elevated.
param(
 [ValidateRange(1,65535)][int]$Port=9913,
 [string]$User=[Security.Principal.WindowsIdentity]::GetCurrent().Name,
 [string]$Node=(Get-Command node.exe -ErrorAction Stop).Source,
 [string]$CodexHome=(Join-Path $env:USERPROFILE '.codex'),
 [string]$CodexCli,
 [string]$Directory=(Join-Path $env:ProgramData 'DotsCodexBridge'),
 [string]$TaskName='DotsCodexBridge'
)
$ErrorActionPreference='Stop'
if(-not $CodexCli){
 $managedCli=Join-Path $CodexHome 'appserver\codex.exe'
 if(Test-Path -LiteralPath $managedCli){$CodexCli=$managedCli}
 else{
  $binRoot=Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
  $candidate=Get-ChildItem -LiteralPath $binRoot -Filter codex.exe -Recurse -File |
   Where-Object {Test-Path -LiteralPath (Join-Path $_.DirectoryName 'codex-code-mode-host.exe')} |
   Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if($candidate){$CodexCli=$candidate.FullName}
 }
}
if(-not $CodexCli -or -not(Test-Path -LiteralPath $CodexCli)){throw 'Specify -CodexCli with the complete installed Codex CLI package.'}
if(-not(Test-Path -LiteralPath $Node)){throw 'Node.js executable not found.'}
$Directory=[IO.Path]::GetFullPath($Directory)
New-Item -ItemType Directory -Path $Directory -Force | Out-Null
$userSid=([Security.Principal.NTAccount]::new($User)).Translate([Security.Principal.SecurityIdentifier]).Value
$grant='*'+$userSid+':(OI)(CI)F'
& icacls $Directory /inheritance:r /grant:r $grant '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if($LASTEXITCODE -ne 0){throw 'Could not restrict the bridge directory permissions.'}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'codex-main-bridge.cjs') -Destination (Join-Path $Directory 'relay.cjs') -Force
$tokenFile=Join-Path $Directory 'token.txt'
if(-not(Test-Path -LiteralPath $tokenFile)){
 $bytes=New-Object byte[] 32
 $rng=[Security.Cryptography.RandomNumberGenerator]::Create()
 try{$rng.GetBytes($bytes)}finally{$rng.Dispose()}
 [IO.File]::WriteAllText($tokenFile,([BitConverter]::ToString($bytes)-replace '-','').ToLower())
}
$configFile=Join-Path $Directory 'config.json'
$config=@{port=$Port;cli=$CodexCli;codexHome=$CodexHome;socket=(Join-Path $CodexHome 'app-server-control\app-server-control.sock');directory=$Directory;tokenFile=$tokenFile;taskName=$TaskName}
[IO.File]::WriteAllText($configFile,($config|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
$relay=Join-Path $Directory 'relay.cjs'
$arguments='"'+$relay+'" --config "'+$configFile+'"'
$action=New-ScheduledTaskAction -Execute $Node -Argument $arguments -WorkingDirectory $Directory
$trigger=New-ScheduledTaskTrigger -AtStartup
$principal=New-ScheduledTaskPrincipal -UserId $User -LogonType S4U -RunLevel Highest
$settings=New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3
if(-not(Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)){throw "Bridge is not listening. Inspect the private bridge.log in $Directory."}
"Main Codex bridge installed on 127.0.0.1:$Port. Token file: $tokenFile (value is never printed)."
