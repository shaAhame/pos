@echo off
REM Double-click to start the POS on this computer.
REM First run installs everything (needs internet). Keep this window open while the shop is open.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Download the LTS version from https://nodejs.org and run this again. & pause & exit /b 1)
if not exist server\.env (echo server\.env is missing. Follow SETUP.md step 3 first. & pause & exit /b 1)
if not exist server\node_modules (echo Installing... & call npm run setup || (pause & exit /b 1))
REM Rebuild the screens when they're missing or from an older version.
fc /b client\public\VERSION client\dist\VERSION >nul 2>nul || (echo Building the app... & call npm run build || (pause & exit /b 1))
start "" http://localhost:5000
call npm start
pause
