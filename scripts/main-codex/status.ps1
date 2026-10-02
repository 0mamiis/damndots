# Salt okunur durum: kısayollar ve ana profil Dots oturumunda mı, orijinal mi gösterir.
$ws = New-Object -ComObject WScript.Shell
foreach ($n in @('Codex.lnk','Codex (Dots).lnk')) {
  $p = Join-Path ([Environment]::GetFolderPath('Desktop')) $n
  if (Test-Path -LiteralPath $p) {
    $l = $ws.CreateShortcut($p)
    Write-Output ("LNK " + $n + " => " + $l.TargetPath + " " + $l.Arguments)
  } else { Write-Output ("LNK " + $n + " YOK") }
}
$mp = Join-Path (Split-Path -Parent $PSScriptRoot) '..\.data\local-stack\client-main\main-profile\main-profile-state.json'
if (Test-Path -LiteralPath $mp) { Write-Output 'PROFIL: Dots oturumu (gecici ayarlar yazili)'; Get-Content -LiteralPath $mp }
else {
  Write-Output 'PROFIL: orijinal'
  $c = Join-Path $env:USERPROFILE '.codex\config.toml'
  if (Test-Path -LiteralPath $c) { Get-Content -LiteralPath $c | Select-Object -First 2 }
}
