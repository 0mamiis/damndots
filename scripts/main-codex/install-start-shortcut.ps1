param([Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][string]$Marker,[string]$Desktop)
# Creates a "Damndots" desktop shortcut for Start-Dots.cmd once, so users do not have to find the script in the repository.
# Skipped when a desktop shortcut already starts Start-Dots.cmd. The marker keeps a deleted shortcut from coming back.
$ErrorActionPreference='Stop'
if(Test-Path -LiteralPath $Marker){Write-Output 'skipped: already handled';exit 0}
if(-not $Desktop){$Desktop=[Environment]::GetFolderPath('DesktopDirectory')}
$script=Join-Path $Root 'Start-Dots.cmd'
if(-not(Test-Path -LiteralPath $script)){throw 'Start-Dots.cmd missing'}
$dataDir=Split-Path -Parent $Marker
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
# Draw the dashboard icon (apps/dashboard/app/icon.svg) into an .ico; the repository only stores text sources.
function New-DamndotsIcon([string]$Path){
 Add-Type -AssemblyName System.Drawing
 $images=@()
 foreach($size in 16,32,48,256){
  $bmp=New-Object Drawing.Bitmap $size,$size;$g=[Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias;$g.Clear([Drawing.Color]::Transparent)
  $k=$size/64.0;$r=16*$k;$p=New-Object Drawing.Drawing2D.GraphicsPath
  $p.AddArc(0,0,2*$r,2*$r,180,90);$p.AddArc($size-2*$r,0,2*$r,2*$r,270,90);$p.AddArc($size-2*$r,$size-2*$r,2*$r,2*$r,0,90);$p.AddArc(0,$size-2*$r,2*$r,2*$r,90,90);$p.CloseFigure()
  $g.FillPath((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(255,0x2f,0x6f,0xd9))),$p)
  $pen=New-Object Drawing.Pen ([Drawing.Color]::FromArgb(140,255,255,255)),([Math]::Max(1,3*$k))
  $g.DrawEllipse($pen,(13*$k),(13*$k),(38*$k),(38*$k))
  $g.FillEllipse([Drawing.Brushes]::White,(23*$k),(23*$k),(18*$k),(18*$k))
  $ms=New-Object IO.MemoryStream;$bmp.Save($ms,[Drawing.Imaging.ImageFormat]::Png);$images+=,@($size,$ms.ToArray());$g.Dispose();$bmp.Dispose();$ms.Dispose()
 }
 $out=New-Object IO.MemoryStream;$w=New-Object IO.BinaryWriter($out)
 $w.Write([uint16]0);$w.Write([uint16]1);$w.Write([uint16]$images.Count);$offset=6+16*$images.Count
 foreach($i in $images){$d=if($i[0] -ge 256){0}else{$i[0]};$w.Write([byte]$d);$w.Write([byte]$d);$w.Write([byte]0);$w.Write([byte]0);$w.Write([uint16]1);$w.Write([uint16]32);$w.Write([uint32]$i[1].Length);$w.Write([uint32]$offset);$offset+=$i[1].Length}
 foreach($i in $images){$w.Write([byte[]]$i[1])}
 [IO.File]::WriteAllBytes($Path,$out.ToArray());$w.Dispose();$out.Dispose()
}
$ws=New-Object -ComObject WScript.Shell
$existing=$null
foreach($file in Get-ChildItem -LiteralPath $Desktop -Filter *.lnk -File -ErrorAction SilentlyContinue){
 try{$l=$ws.CreateShortcut($file.FullName);if(($l.TargetPath+' '+$l.Arguments) -like '*Start-Dots*.cmd*'){$existing=$file.Name;break}}catch{}
}
if($existing){$result='existing: '+$existing}else{
 $path=Join-Path $Desktop 'Damndots.lnk'
 $link=$ws.CreateShortcut($path)
 $link.TargetPath=$script;$link.WorkingDirectory=$Root;$link.Description='Start the Damndots services'
 $icon=Join-Path $dataDir 'damndots.ico'
 try{New-DamndotsIcon $icon;$link.IconLocation=$icon+',0'}catch{}
 $link.Save();$result='created: '+$path
}
Set-Content -LiteralPath $Marker -Value (@{result=$result;at=(Get-Date).ToString('o')}|ConvertTo-Json -Compress) -Encoding utf8
Write-Output $result

