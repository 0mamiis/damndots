# Yedek -> geri yükleme turunu geçici dizinde doğrular; gerçek profile dokunmaz.
param([Parameter(Mandatory)][string]$BackupDir)
$ErrorActionPreference = 'Stop'
$t = Join-Path ([IO.Path]::GetTempPath()) ('dots-restore-test-' + [Guid]::NewGuid().ToString('N'))
try {
  & (Join-Path $PSScriptRoot 'restore.ps1') -BackupDir $BackupDir -CodexHome (Join-Path $t 'codex-home') -AppData (Join-Path $t 'app-data')
  $m = Get-Content -LiteralPath (Join-Path $BackupDir 'manifest.json') -Raw | ConvertFrom-Json
  $bad = 0
  foreach ($e in $m.files) {
    $root = if ($e.area -eq 'codex-home') { Join-Path $t 'codex-home' } else { Join-Path $t 'app-data' }
    if ((Get-FileHash -LiteralPath (Join-Path $root $e.path) -Algorithm SHA256).Hash -ne $e.sha256) { $bad++ }
  }
  Write-Output ("Doğrulama: {0}/{1} dosya özdeş, {2} uyuşmazlık" -f ($m.files.Count - $bad), $m.files.Count, $bad)
  if ($bad) { exit 1 }
} finally { if (Test-Path -LiteralPath $t) { [IO.Directory]::Delete($t, $true) } }
