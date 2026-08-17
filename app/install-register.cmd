@echo off
setlocal EnableExtensions

cd /d "%~dp0"

rem 用绝对路径调 PowerShell，不依赖 PATH。
rem PATH 过长时（本机实测 20361 字符 / 220 个条目），派生出去的 cmd.exe 拿到的 PATH
rem 会被截断到基本不可用，裸写 `powershell` 会以 9009 "not recognized" 失败，
rem 用户看到的就是安装脚本莫名其妙跑不起来。%SystemRoot% 永远存在。
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

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
"%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-register.ps1"
exit /b %ERRORLEVEL%

:run_powershell_unattended
"%PS%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0install-register.ps1" -Unattended
exit /b %ERRORLEVEL%
