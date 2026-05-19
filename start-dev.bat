@echo off
REM ═══════════════════════════════════════════════════════════════════
REM  Chronicle Dev Server — starts backend + frontend against live data
REM ═══════════════════════════════════════════════════════════════════
REM
REM  Uses your real %APPDATA%\Chronicle\chronicle.db (same data as the
REM  installed app). Backend on port 8180, frontend on http://localhost:5180
REM
REM  Press Ctrl+C in either window to stop.
REM ═══════════════════════════════════════════════════════════════════

set CHRONICLE_ROOT=%~dp0

echo.
echo  ╔══════════════════════════════════════════════╗
echo  ║  Chronicle Dev Mode                         ║
echo  ║  Backend:  http://localhost:8180/api/health  ║
echo  ║  Frontend: http://localhost:5180             ║
echo  ║  Data:     %%APPDATA%%\Chronicle\             ║
echo  ╚══════════════════════════════════════════════╝
echo.

REM Build frontend first so the native app has latest code
echo  Building frontend...
cd /d %CHRONICLE_ROOT%frontend
call npx vite build >nul 2>&1
echo  Frontend built.

REM Start backend in a new window (loads from frontend/dist)
start "Chronicle Backend" cmd /k "cd /d %CHRONICLE_ROOT%src-tauri && cargo run 2>&1"

REM Wait a moment for the backend to bind
timeout /t 3 /nobreak >nul

REM Start frontend in a new window
start "Chronicle Frontend" cmd /k "cd /d %CHRONICLE_ROOT%frontend && npm run dev"

REM Wait then open browser
timeout /t 4 /nobreak >nul
start http://localhost:5180

echo.
echo  Both servers started. Close the terminal windows to stop.
echo.
pause
