@echo off
setlocal

cd /d "%~dp0"

if not exist "zero-latency-web-app.exe" (
  echo [Zero-Latency Web] zero-latency-web-app.exe was not found in this folder.
  echo Please keep this script next to zero-latency-web-app.exe.
  pause
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
  pause
  exit /b %INSTALL_EXIT%
)

echo [Zero-Latency Web] Registration updated. You can close this window.
pause
