@echo off
chcp 65001 >nul
title Bedrock Bot Console - Manual Update
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Apply-Update.ps1"
if errorlevel 1 (
  echo.
  echo Update failed. See the message above.
)
pause
