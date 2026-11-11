@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required. Install Node.js, then run this file again.
  pause
  exit /b 1
)
echo Starting Hospitality Growth Desk at http://localhost:3031
echo Keep this window open while the app is in use.
node server.cjs
pause
