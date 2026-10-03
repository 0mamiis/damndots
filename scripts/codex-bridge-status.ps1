# Read-only status: reports listeners and registration, never token values.
param(
 [string]$MainDirectory=(Join-Path $env:ProgramData 'DotsCodexBridge'),
 [string]$LocalDirectory=(Join-Path $env:USERPROFILE '.codex\dots-local-bridge')
)
foreach($entry in @(@{role='Main';directory=$MainDirectory;defaultPort=9913},@{role='Local';directory=$LocalDirectory;defaultPort=9915})){
 $file=Join-Path $entry.directory 'config.json'
 $config=if(Test-Path -LiteralPath $file){Get-Content -LiteralPath $file -Raw|ConvertFrom-Json}else{$null}
 $port=if($entry.role -eq 'Main' -and $config.port){$config.port}elseif($entry.role -eq 'Local' -and $config.localPort){$config.localPort}else{$entry.defaultPort}
 [pscustomobject]@{Role=$entry.role;Configured=($null -ne $config);LoopbackPort=$port;Listening=([bool](Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $port -State Listen -ErrorAction SilentlyContinue));TokenPresent=(Test-Path -LiteralPath (Join-Path $entry.directory 'token.txt'));SshHost=$config.sshHost}
}
