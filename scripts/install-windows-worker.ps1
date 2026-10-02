<#
.SYNOPSIS
  Installs a Dots computer worker on a Windows machine and connects it to a Dots
  server over Tailscale.

.DESCRIPTION
  Everything lives under -InstallRoot (default C:\Dots). Nothing else on the
  machine is modified except:
    * Tailscale is installed if it is missing (skip with -SkipTailscale).
    * One loopback port proxy is added (127.0.0.1:<LocalPort> to the server over
      the tailnet), because the worker only accepts HTTPS or loopback HTTP
      (skip with -SkipPortProxy).
    * A logon task named DotsWorker starts the worker (skip with -NoAutostart).
  A private Node.js 24 is unpacked next to the worker, so any Node.js already
  installed on the machine is left alone.

.EXAMPLE
  .\install-windows-worker.ps1 -ServerAddress 100.64.0.10
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ServerAddress,
  [int]$ServerPort = 9340,
  [int]$LocalPort = 19340,
  [string]$InstallRoot = 'C:\Dots',
  [string]$Repository = '0mamiis/damndots',
  [string]$Ref = 'main',
  [string]$NodeVersion = '24.19.0',
  [string]$EnrollmentToken,
  [switch]$SkipTailscale,
  [switch]$SkipPortProxy,
  [switch]$NoAutostart
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Test-Admin {
  ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
if ((-not $SkipTailscale -or -not $SkipPortProxy -or -not $NoAutostart) -and -not (Test-Admin)) {
  throw 'Run this script from an elevated PowerShell (Run as administrator).'
}

$root = $InstallRoot
$nodeDir = Join-Path $root 'node'
$appDir = Join-Path $root 'app'
$toolsDir = Join-Path $root 'tools'
$workspace = Join-Path $root 'workspace'
$dataDir = Join-Path $root 'data'
$download = Join-Path $root 'download'
foreach ($d in $root, $appDir, $toolsDir, $workspace, $dataDir, $download) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

# The install folder holds the worker credential and the files a SYSTEM/administrator
# task runs. Only SYSTEM and Administrators may read or change it.
icacls $root /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' /C /Q | Out-Null

# 1. Private Node.js ----------------------------------------------------------
$nodeExe = Join-Path $nodeDir 'node.exe'
if (-not (Test-Path $nodeExe) -or ((& $nodeExe -v) -ne "v$NodeVersion")) {
  Step "Downloading Node.js $NodeVersion (private copy)"
  $zipName = "node-v$NodeVersion-win-x64.zip"
  $zip = Join-Path $download $zipName
  Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/$zipName" -OutFile $zip -UseBasicParsing
  $sums = (Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" -UseBasicParsing).Content
  $line = ($sums -split "\r?\n") | Where-Object { $_ -match [regex]::Escape($zipName) } | Select-Object -First 1
  $expected = ($line -split '\s+')[0].Trim().ToLower()
  if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $expected) { throw 'Node.js archive checksum mismatch.' }
  if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
  $tmp = Join-Path $download 'node-extract'
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive $zip -DestinationPath $tmp
  Move-Item (Join-Path $tmp "node-v$NodeVersion-win-x64") $nodeDir
  Remove-Item $tmp -Recurse -Force
}
$npmCmd = Join-Path $nodeDir 'npm.cmd'
$env:PATH = "$nodeDir;$env:PATH"

# 2. Dots source --------------------------------------------------------------
Step "Downloading $Repository@$Ref"
$src = Join-Path $download 'dots-source.zip'
Invoke-WebRequest "https://github.com/$Repository/archive/refs/heads/$Ref.zip" -OutFile $src -UseBasicParsing
$tmp = Join-Path $download 'src-extract'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive $src -DestinationPath $tmp
$top = Get-ChildItem $tmp -Directory | Select-Object -First 1
Get-ChildItem $appDir -Force | Where-Object { $_.Name -ne 'node_modules' } | Remove-Item -Recurse -Force
Get-ChildItem $top.FullName -Force | Move-Item -Destination $appDir -Force
Remove-Item $tmp -Recurse -Force

Step 'Installing worker dependencies'
Push-Location $appDir
try {
  & $npmCmd ci --workspace @dots/worker --workspace @dots/server --workspace @dots/contracts --include-workspace-root --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
} finally { Pop-Location }

Step 'Installing the Codex CLI used by the worker'
if (-not (Test-Path (Join-Path $toolsDir 'package.json'))) { Set-Content (Join-Path $toolsDir 'package.json') '{"private":true}' }
& $npmCmd install --prefix $toolsDir @openai/codex --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Codex CLI install failed.' }
$codexJs = Join-Path $toolsDir 'node_modules\@openai\codex\bin\codex.js'
if (-not (Test-Path $codexJs)) { throw 'Codex CLI entrypoint was not found.' }

# 3. Tailscale ----------------------------------------------------------------
if (-not $SkipTailscale) {
  $tsExe = $null
  $found = Get-Command tailscale -ErrorAction SilentlyContinue
  if ($found) { $tsExe = $found.Source }
  elseif (Test-Path 'C:\Program Files\Tailscale\tailscale.exe') { $tsExe = 'C:\Program Files\Tailscale\tailscale.exe' }
  if (-not $tsExe) {
    Step 'Installing Tailscale'
    $msi = Join-Path $download 'tailscale.msi'
    Invoke-WebRequest 'https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi' -OutFile $msi -UseBasicParsing
    $sig = Get-AuthenticodeSignature $msi
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'Tailscale') { throw 'Tailscale installer signature is not valid.' }
    Start-Process msiexec.exe -ArgumentList @('/i', ('"{0}"' -f $msi), '/qn', '/norestart') -Wait
    $tsExe = 'C:\Program Files\Tailscale\tailscale.exe'
  }
  $state = (& $tsExe status --json 2>$null | ConvertFrom-Json).BackendState
  if ($state -ne 'Running') {
    Step 'Joining the tailnet. Open the login link below and sign in with the SAME account as the Dots server PC.'
    & $tsExe up --unattended
  }
  Step "Checking the tunnel to $($ServerAddress):$ServerPort"
  if (-not (Test-NetConnection $ServerAddress -Port $ServerPort -WarningAction SilentlyContinue).TcpTestSucceeded) {
    throw "Cannot reach $($ServerAddress):$ServerPort. Is the server PC online and exposing the port with 'tailscale serve --tcp $ServerPort'?"
  }
}

# 4. Loopback port proxy ------------------------------------------------------
if (-not $SkipPortProxy) {
  Step "Adding loopback port proxy 127.0.0.1:$LocalPort to $($ServerAddress):$ServerPort"
  $existing = Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue
  $mine = (netsh interface portproxy show v4tov4) -match ('127\.0\.0\.1\s+' + $LocalPort + '\s')
  if ($existing -and -not $mine) { throw "Port $LocalPort is already in use; pass -LocalPort with a free port." }
  netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=$LocalPort 2>$null | Out-Null
  netsh interface portproxy add v4tov4 listenaddress=127.0.0.1 listenport=$LocalPort connectaddress=$ServerAddress connectport=$ServerPort | Out-Null
  Set-Service iphlpsvc -StartupType Automatic -ErrorAction SilentlyContinue
  Start-Service iphlpsvc -ErrorAction SilentlyContinue
}

# 5. Launcher -----------------------------------------------------------------
$chrome = @('C:\Program Files\Google\Chrome\Application\chrome.exe', 'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1
$launcher = Join-Path $root 'start-worker.cmd'
$lines = @(
  '@echo off',
  'setlocal',
  ('set "DOTS_ROOT={0}"' -f $root),
  'set "PATH=%DOTS_ROOT%\node;%PATH%"',
  'set "DOTS_WORKER_DATA_DIR=%DOTS_ROOT%\data"',
  'set "DOTS_CODEX_CLI=%DOTS_ROOT%\tools\node_modules\@openai\codex\bin\codex.js"',
  'set "DOTS_COMPUTER_MODE=pc"'
)
if ($chrome) { $lines += ('set "DOTS_BROWSER_EXECUTABLE={0}"' -f $chrome) }
$lines += 'cd /d "%DOTS_ROOT%\app"'
$lines += ('"%DOTS_ROOT%\node\node.exe" "%DOTS_ROOT%\app\node_modules\tsx\dist\cli.mjs" apps\worker\src\index.ts --server http://127.0.0.1:{0} --root "%DOTS_ROOT%\workspace" --name "{1}" %*' -f $LocalPort, $env:COMPUTERNAME)
Set-Content -Path $launcher -Value $lines -Encoding ASCII

# The live computer view is a WebRTC stream answered by this browser. Without an
# inbound UDP rule for it, the Windows firewall drops the viewer's connection.
if ($chrome -and -not $NoAutostart) {
  Remove-NetFirewallRule -DisplayName 'Dots worker WebRTC' -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName 'Dots worker WebRTC' -Direction Inbound -Action Allow -Protocol UDP -Program $chrome -Profile Any | Out-Null
}

# Keeps the desktop alive when a Remote Desktop window is closed (see enable-keep-desktop.ps1).
# 6. Autostart ----------------------------------------------------------------
if (-not $NoAutostart) {
  Step 'Registering the DotsWorker logon task'
  schtasks /Create /TN DotsWorker /TR ('"{0}"' -f $launcher) /SC ONLOGON /RL HIGHEST /F | Out-Null
  & (Join-Path $appDir 'scripts\enable-keep-desktop.ps1') -InstallRoot $root
}

Step 'Done.'
if ($EnrollmentToken) {
  Write-Host 'Starting the worker with the one-time enrollment code...'
  & $launcher --enrollment $EnrollmentToken
} else {
  Write-Host 'Next: create an enrollment code in the Dots dashboard (Computers) and run:'
  Write-Host "  $launcher --enrollment <code>"
}
