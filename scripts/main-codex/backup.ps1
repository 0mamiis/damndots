# Ana Codex profilinin YAPILANDIRMA yüzeyini yedekler (canlı SQLite veritabanlarına dokunmaz, profili değiştirmez).
# Kullanım: powershell -NoProfile -File scripts/main-codex/backup.ps1 [-Destination <klasör>] [-CodexHome <dizin>] [-AppData <dizin>] [-Keep <sayı>]
#
# Yedek kalabalığı olmasın diye:
#  * config.toml / auth.json / .credentials.json / keybindings.json değişmediyse yeni yedek alınmaz, son yedek kullanılır;
#  * otomatik yedekler (Codex-Backups\main-<tarih>) aynı kritik içerikte tekrarlanmaz ve en fazla -Keep (varsayılan 3) tane tutulur.
# -Destination verilirse bu kurallar uygulanmaz (elle alınan yedek).
param(
  [string]$Destination,
  [string]$CodexHome = (Join-Path $env:USERPROFILE '.codex'),
  [string]$AppData = (Join-Path $env:APPDATA 'Codex\web\Codex'),
  [ValidateRange(1,20)][int]$Keep = 3,
  [switch]$PruneOnly
)
$ErrorActionPreference = 'Stop'
$root = if ($env:DOTS_BACKUP_ROOT) { $env:DOTS_BACKUP_ROOT } else { Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Codex-Backups' }
$auto = -not $Destination
if ($auto) { $Destination = Join-Path $root ('main-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) }
$files = @('config.toml','auth.json','.credentials.json','.codex-global-state.json','opencodex.config.toml','opencodex-catalog.json','opencodex-journal.json','models_cache.json','keybindings.json','installation_id','session_index.jsonl','history.jsonl')
$critical = @('config.toml','auth.json','.credentials.json','keybindings.json')
$dirs  = @('skills','rules','memories')

function Get-Sha([string]$p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash }
function Get-Signature($items,[switch]$AllFiles) {
  $lines = $items | Where-Object { $AllFiles -or ($_.area -eq 'codex-home' -and ($critical -contains $_.path)) } | Sort-Object area,path | ForEach-Object { $_.area + '/' + $_.path + '=' + $_.sha256 }
  $bytes = [Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
  ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes))).Replace('-','')
}
function Get-Backups { if (Test-Path -LiteralPath $root) { Get-ChildItem -LiteralPath $root -Directory | Where-Object { $_.Name -match '^main-\d{8}-\d{6}$' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'manifest.json')) } | Sort-Object Name -Descending } }

$reuse = $false
if ($auto -and -not $PruneOnly) {
  $current = @(); foreach ($f in $critical) { $p = Join-Path $CodexHome $f; if (Test-Path -LiteralPath $p -PathType Leaf) { $current += [pscustomobject]@{ area = 'codex-home'; path = $f; sha256 = (Get-Sha $p) } } }
  $signature = Get-Signature $current
  foreach ($b in (Get-Backups)) {
    try { $m = Get-Content -LiteralPath (Join-Path $b.FullName 'manifest.json') -Raw | ConvertFrom-Json } catch { continue }
    if ($m.codexHome -ne $CodexHome) { continue }
    if ((Get-Signature $m.files) -eq $signature) {
      $valid = $true
      foreach ($e in $m.files) {
        $file = Join-Path (Join-Path $b.FullName $e.area) $e.path
        if (-not(Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Sha $file) -ne $e.sha256) { $valid = $false; break }
      }
      if (-not $valid) { continue }
      $selected = $b.FullName
      Write-Output ('BACKUP_DIR=' + $b.FullName)
      Write-Output 'BACKUP_NEW=0'
      Write-Output ('Ayarlar degismedi; mevcut yedek kullanildi: ' + $b.FullName)
      $reuse = $true; break
    }
  }
}
if (-not $reuse -and -not $PruneOnly) {
  $finalDestination = $Destination
  # Tamamlanmayan deneme main-<tarih> klasörü oluşturmaz; tek hazırlık klasörü yeniden kullanılır.
  if ($auto) { $Destination = Join-Path $root '.main-pending' }
  New-Item -ItemType Directory -Force -Path $Destination | Out-Null
  $entries = New-Object System.Collections.Generic.List[object]
  function Save-File([string]$base,[string]$rel,[string]$area) {
    $src = Join-Path $base $rel
    if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { return }
    $dst = Join-Path (Join-Path $Destination $area) $rel
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst -Force
    $hash = Get-Sha $dst
    if ($hash -ne (Get-Sha $src)) { throw "Dogrulama hatasi: $rel" }
    $entries.Add([ordered]@{ area = $area; path = $rel; sha256 = $hash; bytes = (Get-Item -LiteralPath $dst).Length })
  }
  foreach ($f in $files) { Save-File $CodexHome $f 'codex-home' }
  foreach ($d in $dirs) {
    $dirRoot = Join-Path $CodexHome $d
    if (Test-Path -LiteralPath $dirRoot) { Get-ChildItem -LiteralPath $dirRoot -Recurse -File -Force | ForEach-Object { Save-File $CodexHome ($_.FullName.Substring($CodexHome.Length).TrimStart('\')) 'codex-home' } }
  }
  if (Test-Path -LiteralPath $AppData) { Get-ChildItem -LiteralPath $AppData -File -Force | ForEach-Object { Save-File $AppData $_.Name 'app-data' } }
  $manifest = [ordered]@{ createdAt = (Get-Date).ToString('o'); codexHome = $CodexHome; appData = $AppData; note = 'Yalnizca yapilandirma yuzeyi. sessions/sqlite/plugins gibi canli ve buyuk veriler dahil degildir.'; files = $entries }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Destination 'manifest.json') -Encoding UTF8
  if ($auto) {
    $sourceFull = [IO.Path]::GetFullPath($Destination)
    $targetFull = [IO.Path]::GetFullPath($finalDestination)
    $rootFull = [IO.Path]::GetFullPath($root)
    if ([IO.Path]::GetDirectoryName($sourceFull) -ne $rootFull -or [IO.Path]::GetDirectoryName($targetFull) -ne $rootFull -or (Get-Item -LiteralPath $sourceFull).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Yedek yolu guvenli degil' }
    Move-Item -LiteralPath $sourceFull -Destination $targetFull
    $Destination = $finalDestination
  }
  $total = 0; foreach ($e in $entries) { $total += $e.bytes }
  Write-Output ('BACKUP_DIR=' + $Destination)
  Write-Output 'BACKUP_NEW=1'
  $selected = $Destination
  Write-Output ('Yedek hazir: {0} ({1} dosya, {2:N1} MB)' -f $Destination, $entries.Count, ($total / 1MB))
}

if ($auto) {
  # Yalnızca TÜM dosya hashleri özdeş olan yedekler duplikedir. Seçilen geri dönüş yedeği her zaman korunur.
  $seen = @{}; $kept = @(); $drop = @()
  foreach ($b in (Get-Backups)) {
    try { $sig = Get-Signature ((Get-Content -LiteralPath (Join-Path $b.FullName 'manifest.json') -Raw | ConvertFrom-Json).files) -AllFiles } catch { continue }
    if ($seen.ContainsKey($sig)) { $drop += $b } else { $seen[$sig] = $true; $kept += $b }
  }
  if ($selected) {
    $active = $kept | Where-Object { $_.FullName -eq $selected }
    $kept = @($active) + @($kept | Where-Object { $_.FullName -ne $selected })
  }
  if ($kept.Count -gt $Keep) { $drop += $kept[$Keep..($kept.Count - 1)] }
  foreach ($b in $drop) {
    # Yalnizca Codex-Backups altindaki main-<tarih> klasorleri silinir.
    if ($b.FullName -ne $selected -and $b.Parent.FullName -eq (Get-Item -LiteralPath $root).FullName -and $b.Name -match '^main-\d{8}-\d{6}$' -and -not($b.Attributes -band [IO.FileAttributes]::ReparsePoint)) { Remove-Item -LiteralPath $b.FullName -Recurse -Force; Write-Output ('Eski yedek silindi: ' + $b.Name) }
  }
}
