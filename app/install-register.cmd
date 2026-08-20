@echo off
setlocal EnableExtensions

cd /d "%~dp0"

rem Keep this file pure ASCII. A .cmd carries no encoding declaration: cmd.exe reads it
rem with the console OEM code page, so non-ASCII text is garbled on any machine whose
rem code page differs from the author's -- and a UTF-8 BOM is worse, cmd.exe tries to
rem execute it. There is no BOM fix here the way there is for .ps1, so the rule is ASCII
rem only. Enforced by scripts/testing/windows-script-encoding.mjs.
rem
rem Call PowerShell by absolute path, never through PATH. When PATH is long (measured on
rem the maintainer's machine: 20361 chars / 220 entries) the PATH a spawned cmd.exe
rem receives is truncated to the point of being unusable, and a bare "powershell" fails
rem with 9009 "not recognized" -- what the user sees is the installer mysteriously
rem refusing to start. %SystemRoot% is always present.
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
