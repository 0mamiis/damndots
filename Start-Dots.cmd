@echo off
rem Dots servisleri (sunucu, Codex app-server, worker, panel). Codex penceresi ACILMAZ.
rem Codex'i istedigin zaman masaustundeki "Codex" simgesinden ac.
cd /d "%~dp0"
echo Dots servisleri baslatiliyor. Panel: http://127.0.0.1:4320
echo Yonetici erisim anahtari dosyasi: %~dp0apps\server\.data\server\admin.key
node --env-file-if-exists=.env --import tsx scripts/local-stack.ts --worker --client --main-gateway
pause
