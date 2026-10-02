@echo off
rem Dots ana profil degisikliklerini (cokme vb. sonrasi) geri alir.
cd /d "%~dp0"
set DOTS_CLIENT_DATA_DIR=.data/local-stack/client-main
node --import tsx apps/client/src/index.ts --restore-main-profile
pause
