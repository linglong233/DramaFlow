@echo off
setlocal EnableExtensions

cd /d "%~dp0"
node "%~dp0scripts\start-workspace.mjs"
if errorlevel 1 (
  echo.
  echo [DramaFlow] Startup failed.
  pause
  exit /b 1
)

exit /b 0
