@echo off
setlocal
chcp 65001 >nul
title Bedrock Bot Console - Manual Update
set "SCRIPT=%~dp0Apply-Update.ps1"
if not exist "%SCRIPT%" (
  echo [ERROR] Apply-Update.ps1 が見つかりません。
  echo 更新ZIPを「すべて展開」してから、展開先のBATを実行してください。
  echo ZIPの中から直接実行しないでください。
  pause
  exit /b 1
)
set "POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%POWERSHELL%" (
  echo [ERROR] Windows PowerShell 5.1 が見つかりません。
  pause
  exit /b 1
)
echo Bedrock Bot Console の更新を開始します。
echo.
"%POWERSHELL%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" (
  echo [ERROR] 更新に失敗しました。上に表示された診断ログの場所を確認してください。
) else (
  echo 更新処理が正常に完了しました。
)
echo.
pause
exit /b %RESULT%
