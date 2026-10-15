@echo off
rem Manual Codex launch. If the Dots services are running, Your dot appears in the same main profile.
cd /d "%~dp0"
node --import tsx scripts/launch-codex.ts
if errorlevel 1 pause
