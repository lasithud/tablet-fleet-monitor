@echo off
REM ===========================================================================
REM  Tablet Fleet Monitor launcher
REM  Double-click this file to start the backend and frontend, each in its own
REM  window, then open the dashboard in your browser.
REM  Close either window (or press Ctrl+C in it) to stop that service.
REM ===========================================================================

cd /d "%~dp0"

echo Starting backend  -> http://localhost:3001
start "Fleet Monitor - Backend" cmd /k "npm run backend"

echo Starting frontend -> http://localhost:5173
start "Fleet Monitor - Frontend" cmd /k "npm run frontend"

echo Waiting for the dev server to come up...
timeout /t 6 /nobreak >nul

echo Opening dashboard...
start "" http://localhost:5173

exit /b 0
