# backup.ps1 ile alınan yedeği geri yükler. Her dosyanın mevcut halini önce '<dosya>.pre-restore' olarak saklar.
# Kullanım: powershell -NoProfile -File scripts/main-codex/restore.ps1 -BackupDir <klasör> [-CodexHome <dizin>] [-AppData <dizin>] [-WhatIf]
param(
  [Parameter(Mandatory)][string]$BackupDir,
  [string]$CodexHome,
  [string]$AppData,
  [switch]$WhatIf
)
$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath (Join-Path $BackupDir 'manifest.json') -Raw | ConvertFrom-Json
if (-not $CodexHome) { $CodexHome = $manifest.codexHome }
if (-not $AppData) { $AppData = $manifest.appData }
$running = Get-Process -Name 'ChatGPT','codex' -ErrorAction SilentlyContinue
if ($running -and -not $WhatIf -and $CodexHome -eq $manifest.codexHome) { throw 'Codex çalışıyor. Geri yüklemeden önce Codex uygulamasını kapatın (çalışan oturum dosyaları yeniden yazar).' }
$restored = 0
foreach ($e in $manifest.files) {
  $src = Join-Path (Join-Path $BackupDir $e.area) $e.path
  if ((Get-FileHash -LiteralPath $src -Algorithm SHA256).Hash -ne $e.sha256) { throw "Yedek bozuk: $($e.path)" }
  $root = if ($e.area -eq 'codex-home') { $CodexHome } else { $AppData }
  $dst = Join-Path $root $e.path
  if ($WhatIf) { Write-Output "geri yüklenecek: $dst"; continue }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
  if ((Test-Path -LiteralPath $dst) -and ((Get-FileHash -LiteralPath $dst -Algorithm SHA256).Hash -ne $e.sha256)) { Copy-Item -LiteralPath $dst -Destination ($dst + '.pre-restore') -Force }
  Copy-Item -LiteralPath $src -Destination $dst -Force
  $restored++
}
Write-Output ("{0} dosya {1}" -f $restored, $(if ($WhatIf) { 'denetlendi' } else { "geri yüklendi ($CodexHome)" }))
