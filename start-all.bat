@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [DramaFlow] Node.js was not found in PATH.
  pause
  exit /b 1
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo [DramaFlow] npm.cmd was not found in PATH.
  pause
  exit /b 1
)

if not exist ".env" (
  echo [DramaFlow] .env not found. Copying from .env.example...
  copy /Y ".env.example" ".env" >nul
)

if not exist "node_modules" (
  echo [DramaFlow] node_modules not found. Installing dependencies...
  call npm.cmd install
  if errorlevel 1 goto :error
)

echo [DramaFlow] Building workspace...
call npm.cmd run build
if errorlevel 1 goto :error

echo [DramaFlow] Starting API, Web, and Worker in separate windows...
start "DramaFlow API" cmd /k "cd /d ""%~dp0"" && npm.cmd --workspace @dramaflow/api run start"
start "DramaFlow Web" cmd /k "cd /d ""%~dp0"" && npm.cmd --workspace @dramaflow/web run start"
start "DramaFlow Worker" cmd /k "cd /d ""%~dp0"" && npm.cmd --workspace @dramaflow/worker run start"

echo.
echo [DramaFlow] Web: http://localhost:3000
echo [DramaFlow] Login: http://localhost:3000/login
echo [DramaFlow] API: http://localhost:4000/health
echo [DramaFlow] Swagger: http://localhost:4000/docs
echo.
echo [DramaFlow] Startup windows have been opened.
exit /b 0

:error
echo.
echo [DramaFlow] Startup failed.
pause
exit /b 1
