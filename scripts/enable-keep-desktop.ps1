<#
.SYNOPSIS
  Keeps the Windows desktop alive for the Dots worker when a Remote Desktop
  connection ends.

.DESCRIPTION
  Screen capture fails ("The handle is invalid") once a Remote Desktop session
  loses its display, which happens when the RDP window is minimized or closed.
  This script registers a scheduled task (running as SYSTEM) that moves the
  disconnected session to the console, where it keeps a real display.

  With -Now it also moves the current Remote Desktop session to the console
  immediately. That disconnects your Remote Desktop window; reconnect any time
  to take the session back.

  Close the Remote Desktop window with X instead of minimizing it.
#>
[CmdletBinding()]
param([string]$InstallRoot = 'C:\Dots', [switch]$Now)
$ErrorActionPreference = 'Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this script from an elevated PowerShell.'
}
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
$handler = Join-Path $InstallRoot 'keep-desktop.ps1'
Set-Content -Path $handler -Encoding ASCII -Value @'
Start-Sleep -Seconds 2
$e = Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-TerminalServices-LocalSessionManager/Operational'; Id = 24; StartTime = (Get-Date).AddSeconds(-30) } -MaxEvents 1 -ErrorAction SilentlyContinue
if (-not $e) { exit 0 }
$id = ([xml]$e.ToXml()).Event.UserData.EventXML.SessionID
if ($id -match '^\d+$' -and [int]$id -gt 0) { & "$env:windir\System32\tscon.exe" $id /dest:console }
'@

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <EventTrigger>
      <Enabled>true</Enabled>
      <Subscription>&lt;QueryList&gt;&lt;Query Id="0" Path="Microsoft-Windows-TerminalServices-LocalSessionManager/Operational"&gt;&lt;Select Path="Microsoft-Windows-TerminalServices-LocalSessionManager/Operational"&gt;*[System[(EventID=24)]]&lt;/Select&gt;&lt;/Query&gt;&lt;/QueryList&gt;</Subscription>
    </EventTrigger>
  </Triggers>
  <Principals><Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>Parallel</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT2M</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author"><Exec><Command>powershell.exe</Command><Arguments>-NoProfile -ExecutionPolicy Bypass -File "$handler"</Arguments></Exec></Actions>
</Task>
"@
$xmlPath = Join-Path $env:TEMP 'dots-keep-desktop.xml'
Set-Content -Path $xmlPath -Value $xml -Encoding Unicode
schtasks /Create /TN DotsKeepDesktop /XML $xmlPath /F | Out-Null
Remove-Item $xmlPath -Force
Write-Host 'Registered the DotsKeepDesktop task. Closing a Remote Desktop window now keeps the desktop alive for the Dot.'

if ($Now) {
  $line = (qwinsta | Select-String 'rdp-tcp#\d+' | Select-Object -First 1)
  if (-not $line) { Write-Host 'No active Remote Desktop session found.'; return }
  $id = ($line.Line -split '\s+' | Where-Object { $_ -match '^\d+$' } | Select-Object -First 1)
  Write-Host "Moving session $id to the console; this Remote Desktop window will disconnect."
  & "$env:windir\System32\tscon.exe" $id /dest:console
}

