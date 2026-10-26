# Run after normal Dots native setup. A Codex chat or executor environment is not required.
param(
 [string]$SshHost,
 [switch]$LocalOnly,
 [string]$ComposerAppRoot,
 [string]$TokenDestinationDirectory,
 [ValidateRange(1,65535)][int]$LocalPort=9915,
 [ValidateRange(1,65535)][int]$RemotePort=9914,
 [string]$Directory=(Join-Path $env:USERPROFILE '.codex\dots-local-bridge'),
 [string]$NativeManifest=(Join-Path $PSScriptRoot '..\.data\local-stack\native\cli-bridge.json'),
 [string]$Node=(Get-Command node.exe -ErrorAction Stop).Source
)
$ErrorActionPreference='Stop'
if(-not $LocalOnly -and (-not $SshHost -or $SshHost -notmatch '^[^- \t\r\n][^ \t\r\n]*$')){throw 'Provide an SSH host alias, or use -LocalOnly when the backend runs on this PC.'}
if($LocalOnly -and $SshHost){throw 'Use either -LocalOnly or -SshHost, not both.'}
if(-not(Test-Path -LiteralPath $NativeManifest)){throw 'Run normal Dots native setup first, or specify -NativeManifest.'}
$manifest=Get-Content -LiteralPath $NativeManifest -Raw | ConvertFrom-Json
if(-not $manifest.gateway -or -not(Test-Path -LiteralPath $manifest.certificate)){throw 'Native gateway certificate is not configured.'}
$ssh=if($LocalOnly){$null}else{(Get-Command ssh.exe -ErrorAction Stop).Source}
$Directory=[IO.Path]::GetFullPath($Directory)
New-Item -ItemType Directory -Path $Directory -Force | Out-Null
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$grant='*'+$sid+':(OI)(CI)F'
& icacls $Directory /inheritance:r /grant:r $grant '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if($LASTEXITCODE -ne 0){throw 'Could not restrict the bridge directory permissions.'}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'codex-local-tools-bridge.cjs') -Destination (Join-Path $Directory 'bridge.cjs') -Force
foreach($helper in @('composer-prediction-settings.cjs','composer-prediction-models.cjs')){
 Copy-Item -LiteralPath (Join-Path $PSScriptRoot $helper) -Destination (Join-Path $Directory $helper) -Force
}
$tokenFile=Join-Path $Directory 'token.txt'
if(-not(Test-Path -LiteralPath $tokenFile)){
 $bytes=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
 try{$rng.GetBytes($bytes)}finally{$rng.Dispose()}
 [IO.File]::WriteAllText($tokenFile,([BitConverter]::ToString($bytes)-replace '-','').ToLower())
}
$config=@{nativeGateway=$manifest.gateway;certificate=$manifest.certificate;sshHost=$SshHost;sshExecutable=$ssh;localPort=$LocalPort;remotePort=$RemotePort;directory=$Directory;localOnly=[bool]$LocalOnly}
if($ComposerAppRoot){$config.composerAppRoot=[IO.Path]::GetFullPath($ComposerAppRoot)}
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
}else{'A bridge is already listening. Restart it to load the updated files.'}
"Local Codex bridge installed. Private token: $tokenFile. Backend loopback port: $RemotePort."
if(-not $LocalOnly -and -not $TokenDestinationDirectory){'Copy this token file privately to the backend as local-token.txt; set DOTS_LOCAL_CODEX_TOKEN_FILE if using a non-default location.'}
