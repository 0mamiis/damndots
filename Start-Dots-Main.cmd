@echo off
rem Legacy file name: it now only starts the Dots services and does not open Codex.
cd /d "%~dp0"
call Start-Dots.cmd
