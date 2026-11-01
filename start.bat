@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or later is required.
  echo Install Node.js 24 LTS, then run this file again.
  pause
  exit /b 1
)

for /f "usebackq delims=" %%V in (`node -p "Number(process.versions.node.split('.')[0])"`) do set NODE_MAJOR=%%V
if %NODE_MAJOR% LSS 24 (
  echo Detected Node.js major version %NODE_MAJOR%.
  echo Node.js 24 or later is required. Please update Node.js.
  pause
  exit /b 1
)

set "LOG_FILE=%USERPROFILE%\Desktop\bot-console-start.log"
echo ===== Bedrock Bot Console 0.3.5 ===== > "%LOG_FILE%"
echo Started: %DATE% %TIME% >> "%LOG_FILE%"
echo Node: >> "%LOG_FILE%"
node --version >> "%LOG_FILE%" 2>&1

echo.
echo Diagnostic log: "%LOG_FILE%"
if not exist node_modules (
  echo Installing dependencies...
  call npm install --no-audit --no-fund >> "%LOG_FILE%" 2>&1
  if errorlevel 1 (
    echo Dependency installation failed. See the diagnostic log.
    echo npm install failed with code %ERRORLEVEL% >> "%LOG_FILE%"
    pause
    exit /b 1
  )
)

echo Launching application... >> "%LOG_FILE%"
call npm start >> "%LOG_FILE%" 2>&1
set "APP_EXIT=%ERRORLEVEL%"
echo Application exit code: %APP_EXIT% >> "%LOG_FILE%"
echo Ended: %DATE% %TIME% >> "%LOG_FILE%"
if not "%APP_EXIT%"=="0" (
  echo The application exited with code %APP_EXIT%. See the diagnostic log.
  pause
)
exit /b %APP_EXIT%
