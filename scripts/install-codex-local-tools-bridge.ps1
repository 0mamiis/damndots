# Run after normal Dots native setup. A Codex chat or executor environment is not required.
param(
 [Parameter(Mandatory=$true)][ValidatePattern('^[^- \t\r\n][^ \t\r\n]*$')][string]$SshHost,
 [string]$TokenDestinationDirectory,
 [ValidateRange(1,65535)][int]$LocalPort=9915,
 [ValidateRange(1,65535)][int]$RemotePort=9914,
 [string]$Directory=(Join-Path $env:USERPROFILE '.codex\dots-local-bridge'),
 [string]$NativeManifest=(Join-Path $PSScriptRoot '..\.data\local-stack\native\cli-bridge.json'),
 [string]$Node=(Get-Command node.exe -ErrorAction Stop).Source
)
$ErrorActionPreference='Stop'
if(-not(Test-Path -LiteralPath $NativeManifest)){throw 'Run normal Dots native setup first, or specify -NativeManifest.'}
$manifest=Get-Content -LiteralPath $NativeManifest -Raw | ConvertFrom-Json
if(-not $manifest.gateway -or -not(Test-Path -LiteralPath $manifest.certificate)){throw 'Native gateway certificate is not configured.'}
$ssh=(Get-Command ssh.exe -ErrorAction Stop).Source
$Directory=[IO.Path]::GetFullPath($Directory)
New-Item -ItemType Directory -Path $Directory -Force | Out-Null
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$grant='*'+$sid+':(OI)(CI)F'
& icacls $Directory /inheritance:r /grant:r $grant '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if($LASTEXITCODE -ne 0){throw 'Could not restrict the bridge directory permissions.'}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'codex-local-tools-bridge.cjs') -Destination (Join-Path $Directory 'bridge.cjs') -Force
$tokenFile=Join-Path $Directory 'token.txt'
if(-not(Test-Path -LiteralPath $tokenFile)){
 $bytes=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
 try{$rng.GetBytes($bytes)}finally{$rng.Dispose()}
 [IO.File]::WriteAllText($tokenFile,([BitConverter]::ToString($bytes)-replace '-','').ToLower())
}
$config=@{nativeGateway=$manifest.gateway;certificate=$manifest.certificate;sshHost=$SshHost;sshExecutable=$ssh;localPort=$LocalPort;remotePort=$RemotePort;directory=$Directory}
[IO.File]::WriteAllText((Join-Path $Directory 'config.json'),($config|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
if($TokenDestinationDirectory){
 $target=Join-Path $TokenDestinationDirectory 'local-token.txt'
 if(-not(Test-Path -LiteralPath $TokenDestinationDirectory)){throw 'Create a private token destination directory on the backend first.'}
 Copy-Item -LiteralPath $tokenFile -Destination $target -Force
}
$script=Join-Path $Directory 'bridge.cjs'
$startup=Join-Path ([Environment]::GetFolderPath('Startup')) 'Dots-Local-Codex-Bridge.vbs'
$vbs='CreateObject("WScript.Shell").Run """'+$Node+'"" ""'+$script+'""", 0, False'
[IO.File]::WriteAllText($startup,$vbs)
if(-not(Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue)){
 Start-Process -FilePath $Node -ArgumentList @('"'+$script+'"') -WindowStyle Hidden
}
"Local Codex bridge installed. Private token: $tokenFile. Backend loopback port: $RemotePort."
if(-not $TokenDestinationDirectory){'Copy this token file privately to the backend as local-token.txt; set DOTS_LOCAL_CODEX_TOKEN_FILE if using a non-default location.'}
