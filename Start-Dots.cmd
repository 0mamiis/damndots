@echo off
rem Starts the Dots services (server, Codex app-server, worker, dashboard). It does NOT open Codex.
rem Open Codex yourself from your normal shortcut.
cd /d "%~dp0"
echo Starting Dots services. Dashboard: http://127.0.0.1:4320
echo Admin key file: %~dp0apps\server\.data\server\admin.key
node --env-file-if-exists=.env --import tsx scripts/local-stack.ts --worker --client --main-gateway
pause
