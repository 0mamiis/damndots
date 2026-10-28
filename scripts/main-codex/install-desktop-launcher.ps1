param([Parameter(Mandatory=$true)][string]$Data)
$ErrorActionPreference='Stop'
$pkg=Get-AppxPackage -Name OpenAI.Codex|Select-Object -First 1
if(-not $pkg){throw 'Installed Codex package missing'}
$images=@()
foreach($size in @(16,20,24,32,40,48,60,256)){
 $file=Join-Path $pkg.InstallLocation "assets/Square44x44Logo.targetsize-${size}_altform-unplated.png"
 if(Test-Path $file){$images+=@{size=$size;bytes=[IO.File]::ReadAllBytes($file)}}
}
if($images.Count -eq 0){throw 'Package icon assets missing'}
$memory=New-Object IO.MemoryStream;$writer=New-Object IO.BinaryWriter($memory)
try{
 $writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]$images.Count)
 $offset=6+16*$images.Count
 foreach($image in $images){$dimension=if($image.size -eq 256){0}else{$image.size};$writer.Write([byte]$dimension);$writer.Write([byte]$dimension);$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$image.bytes.Length);$writer.Write([uint32]$offset);$offset+=$image.bytes.Length}
 foreach($image in $images){$writer.Write([byte[]]$image.bytes)}
 $icon=Join-Path $Data 'codex-taskbar.ico';[IO.File]::WriteAllBytes($icon,$memory.ToArray())
}finally{$writer.Dispose();$memory.Dispose()}
$source=Join-Path $PSScriptRoot 'desktop-launcher.cs';$exe=Join-Path $Data 'desktop-launcher.exe'
$hash=(Get-FileHash $source -Algorithm SHA256).Hash+' '+(Get-FileHash $icon -Algorithm SHA256).Hash
$hashFile=Join-Path $Data 'desktop-launcher.source-hash'
if(-not(Test-Path $exe) -or -not(Test-Path $hashFile) -or (Get-Content $hashFile -Raw).Trim() -ne $hash){
 if(Test-Path $exe){Remove-Item -LiteralPath $exe}
 $parameters=New-Object CodeDom.Compiler.CompilerParameters
 $parameters.GenerateExecutable=$true;$parameters.GenerateInMemory=$false;$parameters.OutputAssembly=$exe
 $parameters.CompilerOptions='/target:winexe /win32icon:"'+$icon+'" /platform:x64'
 [void]$parameters.ReferencedAssemblies.Add('System.dll');[void]$parameters.ReferencedAssemblies.Add('System.Web.Extensions.dll')
 $compiler=New-Object Microsoft.CSharp.CSharpCodeProvider
 try{$result=$compiler.CompileAssemblyFromSource($parameters,[IO.File]::ReadAllText($source));if($result.Errors.HasErrors){throw ($result.Errors|Out-String)}}finally{$compiler.Dispose()}
 [IO.File]::WriteAllText($hashFile,$hash)
}
$ws=New-Object -ComObject WScript.Shell
$links=@((Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'ChatGPT.lnk'),(Join-Path ([Environment]::GetFolderPath('Programs')) 'ChatGPT.lnk'),(Join-Path $env:APPDATA 'Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar/ChatGPT.lnk'))
foreach($file in $links){
 if(-not(Test-Path $file)){continue}
 $link=$ws.CreateShortcut($file)
 if($link.TargetPath -ne $exe -and $link.TargetPath -ne (Join-Path $Data 'desktop-features/app/ChatGPT.exe') -and -not($link.TargetPath -eq (Join-Path $env:WINDIR 'explorer.exe') -and $link.Arguments -eq 'shell:AppsFolder\OpenAI.Codex_2p2nqsd0c76g0!App')){continue}
 $link.TargetPath=$exe;$link.Arguments='';$link.WorkingDirectory=$Data;$link.IconLocation=$icon+',0';$link.Save()
}
Write-Output ('Desktop launcher installed; '+$images.Count+' native icon sizes; existing shortcuts updated.')
