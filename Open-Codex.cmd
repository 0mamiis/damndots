@echo off
rem Codex'in MANUEL acilisi. Dots servisleri aciksa ayni ana profilde Your dot gelir.
cd /d "%~dp0"
node --import tsx scripts/launch-codex.ts
if errorlevel 1 pause
