@echo off
setlocal EnableExtensions

cd /d "%~dp0"

set "UNATTENDED=0"
if /i "%~1"=="--unattended" set "UNATTENDED=1"
if /i "%~1"=="-unattended" set "UNATTENDED=1"

if exist "%~dp0install-register.ps1" goto run_powershell

if not exist "zero-latency-web-app.exe" (
  echo [Zero-Latency Web] zero-latency-web-app.exe was not found in this folder.
  echo Please keep this script next to zero-latency-web-app.exe.
  if "%UNATTENDED%"=="0" pause
  exit /b 1
)

echo [Zero-Latency Web] Updating per-user registry registration...
"%~dp0zero-latency-web-app.exe" --install
set "INSTALL_EXIT=%ERRORLEVEL%"

echo.
echo [Zero-Latency Web] Current registration status:
"%~dp0zero-latency-web-app.exe" --status

echo.
if not "%INSTALL_EXIT%"=="0" (
  echo [Zero-Latency Web] Registration failed with exit code %INSTALL_EXIT%.
  if "%UNATTENDED%"=="0" pause
  exit /b %INSTALL_EXIT%
)

echo [Zero-Latency Web] Registration updated. You can close this window.
if "%UNATTENDED%"=="0" pause
exit /b 0

:run_powershell
if "%UNATTENDED%"=="1" goto run_powershell_unattended
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-register.ps1"
exit /b %ERRORLEVEL%

:run_powershell_unattended
powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0install-register.ps1" -Unattended
exit /b %ERRORLEVEL%
