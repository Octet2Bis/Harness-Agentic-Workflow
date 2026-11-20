@echo off
rem Cockpit local du plan carriere : ouvre http://127.0.0.1:8766/ (bun + archon sur le PATH).
rem S'il tourne deja (icone Cockpit, tache de session d'install-cockpit.ps1), on ouvre juste la page.
rem Le dossier carriere est celui du harness (.local\career, migre de Master Plan le 2026-11-13).
cd /d "%~dp0..\.."
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri http://127.0.0.1:8766/ -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel%==0 (
  powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0cockpit-launch.ps1" -Port 8766
  exit /b 0
)
bun integrations\cockpit\cockpit.ts --career-dir "%~dp0..\..\.local\career" %*
