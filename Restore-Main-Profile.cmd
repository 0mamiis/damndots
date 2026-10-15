@echo off
rem Reverts Dots changes to the main Codex profile (for example after a crash).
cd /d "%~dp0"
set DOTS_CLIENT_DATA_DIR=.data/local-stack/client-main
node --import tsx apps/client/src/index.ts --restore-main-profile
pause
