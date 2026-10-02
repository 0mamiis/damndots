<#
.SYNOPSIS
  Installs Dots on a Windows machine: a computer worker, the headless server, or both.

.DESCRIPTION
  -Role Worker (default)  Installs a computer worker and connects it to an existing Dots
                          server over Tailscale (or HTTPS). Needs -ServerAddress.
  -Role Server            Installs the headless Dots server and the Codex app-server it
                          drives, starts it at boot and forwards its port to the tailnet.
                          Administer it from a dashboard on another machine.
  -Role Both              Server plus a worker on the same machine, so the Dot runs on and
                          controls this machine.

  Everything lives under -InstallRoot (default C:\Dots), which only SYSTEM and
  Administrators may access. A private Node.js 24 is unpacked there, so any Node.js already
  installed is left alone. Other changes, each skippable:
    * Tailscale is installed if it is missing (-SkipTailscale).
    * Server role: the server port is forwarded to the tailnet only ("tailscale serve").
    * Worker role: an inbound UDP firewall rule for the worker browser (live view), a logon
      task named DotsWorker and a task that keeps the desktop alive when a Remote Desktop
      window closes (-NoAutostart skips tasks and the firewall rule).
    * A loopback port proxy to the server, only with -UsePortProxy (older workers that
      cannot use a Tailscale address directly).

.EXAMPLE
  .\install-windows-worker.ps1 -ServerAddress 100.64.0.10

.EXAMPLE
  .\install-windows-worker.ps1 -Role Both
#>
[CmdletBinding()]
param(
  [ValidateSet('Worker', 'Server', 'Both')][string]$Role = 'Worker',
  [string]$ServerAddress,
  [int]$ServerPort = 9340,
  [int]$LocalPort = 19340,
  [string]$InstallRoot = 'C:\Dots',
  [string]$Repository = '0mamiis/damndots',
  [string]$Ref = 'main',
  [string]$NodeVersion = '24.19.0',
  [string]$Model,
  [string]$EnrollmentToken,
  [switch]$UsePortProxy,
  [switch]$SkipTailscale,
  [switch]$NoAutostart
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Test-Admin {
  ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
$wantWorker = $Role -in 'Worker', 'Both'
$wantServer = $Role -in 'Server', 'Both'
if ($Role -eq 'Worker' -and -not $ServerAddress) { throw '-ServerAddress is required for the Worker role (the tailnet address of the Dots server).' }
if ((-not $SkipTailscale -or -not $NoAutostart -or $UsePortProxy) -and -not (Test-Admin)) {
  throw 'Run this script from an elevated PowerShell (Run as administrator).'
}

$root = $InstallRoot
$nodeDir = Join-Path $root 'node'
$appDir = Join-Path $root 'app'
$toolsDir = Join-Path $root 'tools'
$workspace = Join-Path $root 'workspace'
$dataDir = Join-Path $root 'data'
$serverData = Join-Path $root 'server-data'
$download = Join-Path $root 'download'
foreach ($d in $root, $appDir, $toolsDir, $download) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
if ($wantWorker) { foreach ($d in $workspace, $dataDir) { New-Item -ItemType Directory -Force -Path $d | Out-Null } }
if ($wantServer) { New-Item -ItemType Directory -Force -Path $serverData | Out-Null }

# The install folder holds credentials and the files that SYSTEM/administrator tasks run.
# Only SYSTEM and Administrators may read or change it. (Do not add /T: it would empty the
# permissions of every child instead of letting them inherit these.)
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
$archive = if ($Ref -match '^[0-9a-f]{40}$') { $Ref } else { "refs/heads/$Ref" }
Invoke-WebRequest "https://github.com/$Repository/archive/$archive.zip" -OutFile $src -UseBasicParsing
$tmp = Join-Path $download 'src-extract'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive $src -DestinationPath $tmp
$top = Get-ChildItem $tmp -Directory | Select-Object -First 1
Get-ChildItem $appDir -Force | Where-Object { $_.Name -ne 'node_modules' } | Remove-Item -Recurse -Force
Get-ChildItem $top.FullName -Force | Move-Item -Destination $appDir -Force
Remove-Item $tmp -Recurse -Force

Step 'Installing dependencies'
Push-Location $appDir
try {
  & $npmCmd ci --workspace @dots/worker --workspace @dots/server --workspace @dots/client --workspace @dots/contracts --include-workspace-root --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
} finally { Pop-Location }

Step 'Installing the Codex CLI'
if (-not (Test-Path (Join-Path $toolsDir 'package.json'))) { Set-Content (Join-Path $toolsDir 'package.json') '{"private":true}' }
& $npmCmd install --prefix $toolsDir @openai/codex --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Codex CLI install failed.' }
$codexJs = Join-Path $toolsDir 'node_modules\@openai\codex\bin\codex.js'
if (-not (Test-Path $codexJs)) { throw 'Codex CLI entrypoint was not found.' }

# 3. Tailscale ----------------------------------------------------------------
$tsExe = $null
if (-not $SkipTailscale) {
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
    Step 'Joining the tailnet. Open the login link below and sign in with the SAME account as your other Dots machines.'
    & $tsExe up --unattended
  }
}

# Where the worker reaches the server.
if ($Role -eq 'Both') { $serverUrl = "http://127.0.0.1:$ServerPort" }
elseif ($ServerAddress -match '^https://') { $serverUrl = $ServerAddress.TrimEnd('/') }
elseif ($UsePortProxy) { $serverUrl = "http://127.0.0.1:$LocalPort" }
else { $serverUrl = "http://$($ServerAddress):$ServerPort" }
if ($Role -eq 'Worker' -and -not $SkipTailscale -and $ServerAddress -notmatch '^https://') {
  Step "Checking the connection to $($ServerAddress):$ServerPort"
  if (-not (Test-NetConnection $ServerAddress -Port $ServerPort -WarningAction SilentlyContinue).TcpTestSucceeded) {
    throw "Cannot reach $($ServerAddress):$ServerPort. Is the Dots server online and forwarded to the tailnet (dashboard: Servers > Network access, or 'tailscale serve --tcp $ServerPort')?"
  }
}
if ($Role -eq 'Worker' -and $UsePortProxy) {
  Step "Adding loopback port proxy 127.0.0.1:$LocalPort to $($ServerAddress):$ServerPort"
  $existing = Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue
  $mine = (netsh interface portproxy show v4tov4) -match ('127\.0\.0\.1\s+' + $LocalPort + '\s')
  if ($existing -and -not $mine) { throw "Port $LocalPort is already in use; pass -LocalPort with a free port." }
  netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=$LocalPort 2>$null | Out-Null
  netsh interface portproxy add v4tov4 listenaddress=127.0.0.1 listenport=$LocalPort connectaddress=$ServerAddress connectport=$ServerPort | Out-Null
  Set-Service iphlpsvc -StartupType Automatic -ErrorAction SilentlyContinue
  Start-Service iphlpsvc -ErrorAction SilentlyContinue
}

# 4. Server -------------------------------------------------------------------
if ($wantServer) {
  $serverLauncher = Join-Path $root 'start-server.cmd'
  $lines = @(
    '@echo off',
    'setlocal',
    ('set "DOTS_ROOT={0}"' -f $root),
    'set "PATH=%DOTS_ROOT%\node;%PATH%"',
    'set "DOTS_DATA_DIR=%DOTS_ROOT%\server-data"',
    ('set "DOTS_PORT={0}"' -f $ServerPort),
    'set "DOTS_CODEX_CLI=%DOTS_ROOT%\tools\node_modules\@openai\codex\bin\codex.js"'
  )
  if ($Model) { $lines += ('set "DOTS_MODEL={0}"' -f $Model) }
  $lines += 'cd /d "%DOTS_ROOT%\app"'
  $lines += '"%DOTS_ROOT%\node\node.exe" "%DOTS_ROOT%\app\node_modules\tsx\dist\cli.mjs" scripts\server-stack.ts'
  Set-Content -Path $serverLauncher -Value $lines -Encoding ASCII
  if (-not $NoAutostart) {
    Step 'Registering the DotsServer task (starts at boot, runs as SYSTEM)'
    schtasks /Create /TN DotsServer /TR ('"{0}"' -f $serverLauncher) /SC ONSTART /RU SYSTEM /RL HIGHEST /F | Out-Null
    schtasks /Run /TN DotsServer | Out-Null
  }
  if ($tsExe -and -not $NoAutostart) {
    Step "Forwarding port $ServerPort to the tailnet only"
    & $tsExe serve --bg --tcp $ServerPort "tcp://127.0.0.1:$ServerPort" | Out-Null
  }
}

# 5. Worker -------------------------------------------------------------------
if ($wantWorker) {
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
  $lines += ('"%DOTS_ROOT%\node\node.exe" "%DOTS_ROOT%\app\node_modules\tsx\dist\cli.mjs" apps\worker\src\index.ts --server {0} --root "%DOTS_ROOT%\workspace" --name "{1}" %*' -f $serverUrl, $env:COMPUTERNAME)
  Set-Content -Path $launcher -Value $lines -Encoding ASCII

  # The live computer view is a WebRTC stream answered by this browser. Without an
  # inbound UDP rule for it, the Windows firewall drops the viewer's connection.
  if ($chrome -and -not $NoAutostart) {
    Remove-NetFirewallRule -DisplayName 'Dots worker WebRTC' -ErrorAction SilentlyContinue
    New-NetFirewallRule -DisplayName 'Dots worker WebRTC' -Direction Inbound -Action Allow -Protocol UDP -Program $chrome -Profile Any | Out-Null
  }
  if (-not $NoAutostart) {
    Step 'Registering the DotsWorker logon task'
    schtasks /Create /TN DotsWorker /TR ('"{0}"' -f $launcher) /SC ONLOGON /RL HIGHEST /F | Out-Null
    # Keeps the desktop alive when a Remote Desktop window is closed.
    & (Join-Path $appDir 'scripts\enable-keep-desktop.ps1') -InstallRoot $root
  }
}

Step 'Done.'
if ($wantServer) {
  Write-Host "Server admin key file: $(Join-Path $serverData 'admin.key')  (read it on this machine only; do not paste it into chats)"
  if ($tsExe) {
    $ip = (& $tsExe ip -4 2>$null | Select-Object -First 1)
    if ($ip) { Write-Host "Add this server in the dashboard (Servers > Add host): http://$($ip):$ServerPort" }
  }
}
if ($wantWorker) {
  if ($EnrollmentToken) {
    Write-Host 'Starting the worker with the one-time enrollment code...'
    & $launcher --enrollment $EnrollmentToken
  } else {
    Write-Host 'Next: create an enrollment code in the Dots dashboard (Computers) and run:'
    Write-Host "  $launcher --enrollment <code>"
  }
}
