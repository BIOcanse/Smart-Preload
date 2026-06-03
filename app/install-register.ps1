$ErrorActionPreference = "Stop"

Set-Location -LiteralPath $PSScriptRoot

$AppExe = Join-Path $PSScriptRoot "zero-latency-web-app.exe"
$RegistryPath = "HKCU:\Software\ZeroLatencyWeb"

function Get-FullPathOrNull {
  param([string]$Path)

  if ([string]::IsNullOrWhiteSpace($Path)) {
    return $null
  }

  try {
    return [System.IO.Path]::GetFullPath($Path)
  } catch {
    return $null
  }
}

function Test-SamePath {
  param(
    [string]$Left,
    [string]$Right
  )

  $leftFull = Get-FullPathOrNull $Left
  $rightFull = Get-FullPathOrNull $Right

  if (-not $leftFull -or -not $rightFull) {
    return $false
  }

  return [string]::Equals($leftFull.TrimEnd('\'), $rightFull.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-PathInside {
  param(
    [string]$Parent,
    [string]$Child
  )

  $parentFull = Get-FullPathOrNull $Parent
  $childFull = Get-FullPathOrNull $Child

  if (-not $parentFull -or -not $childFull) {
    return $false
  }

  $parentPrefix = $parentFull.TrimEnd('\') + '\'
  $childPrefix = $childFull.TrimEnd('\') + '\'
  return $childPrefix.StartsWith($parentPrefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-SafeOldAppDirectory {
  param(
    [string]$OldAppPath,
    [string]$OldDir,
    [string]$CurrentDir
  )

  $failedResult = [pscustomobject]@{
    Safe = $false
    Missing = @()
  }

  if (-not (Test-Path -LiteralPath $OldDir -PathType Container)) {
    $failedResult.Missing = @("old app directory::directory")
    return $failedResult
  }

  if ((Split-Path -Leaf $OldAppPath) -ine "zero-latency-web-app.exe") {
    $failedResult.Missing = @("registered app path must end with zero-latency-web-app.exe::file")
    return $failedResult
  }

  if (Test-SamePath $OldDir $CurrentDir) {
    $failedResult.Missing = @("old app directory must differ from current directory::directory")
    return $failedResult
  }

  if ((Test-PathInside $OldDir $CurrentDir) -or (Test-PathInside $CurrentDir $OldDir)) {
    $failedResult.Missing = @("old/current directories must not contain each other::directory")
    return $failedResult
  }

  $root = [System.IO.Path]::GetPathRoot((Get-FullPathOrNull $OldDir))
  if (Test-SamePath $OldDir $root) {
    $failedResult.Missing = @("old app directory must not be a drive root::directory")
    return $failedResult
  }

  $requiredEntries = @(
    @{ Name = "zero-latency-web-app.exe"; Type = "Leaf" },
    @{ Name = "install-register.cmd"; Type = "Leaf" },
    @{ Name = "README.md"; Type = "Leaf" },
    @{ Name = "VERSION.txt"; Type = "Leaf" },
    @{ Name = "portable"; Type = "Container" }
  )
  $missingEntries = @()

  foreach ($entry in $requiredEntries) {
    $entryPath = Join-Path $OldDir $entry.Name
    if (-not (Test-Path -LiteralPath $entryPath -PathType $entry.Type)) {
      $missingEntries += "$($entry.Name)::$($entry.Type)"
    }
  }

  $allowedTopLevelNames = @(
    "zero-latency-web-app.exe",
    "install-register.cmd",
    "install-register.ps1",
    "README.md",
    "VERSION.txt",
    "portable"
  )
  $unexpectedTopLevelEntries = Get-ChildItem -LiteralPath $OldDir -Force |
    Where-Object { $allowedTopLevelNames -notcontains $_.Name } |
    ForEach-Object { "$($_.Name)::$(if ($_.PSIsContainer) { 'Container' } else { 'Leaf' })" }

  if ($unexpectedTopLevelEntries.Count -gt 0) {
    $missingEntries += "unexpected top-level entries found: $($unexpectedTopLevelEntries -join ', ')"
  }

  return [pscustomobject]@{
    Safe = ($missingEntries.Count -eq 0)
    Missing = $missingEntries
  }
}

function Stop-OldAppProcesses {
  param([string]$OldAppPath)

  $oldFull = Get-FullPathOrNull $OldAppPath
  if (-not $oldFull) {
    return
  }

  $processes = Get-CimInstance Win32_Process -Filter "Name = 'zero-latency-web-app.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ExecutablePath -and
      [string]::Equals((Get-FullPathOrNull $_.ExecutablePath), $oldFull, [System.StringComparison]::OrdinalIgnoreCase)
    }

  foreach ($process in $processes) {
    Write-Host "[Zero-Latency Web] Stopping old app process PID $($process.ProcessId)..."
    Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
  }
}

if (-not (Test-Path -LiteralPath $AppExe -PathType Leaf)) {
  Write-Host "[Zero-Latency Web] zero-latency-web-app.exe was not found in this folder."
  Write-Host "[Zero-Latency Web] Please keep this script next to zero-latency-web-app.exe."
  Read-Host "Press Enter to close"
  exit 1
}

$currentAppPath = (Resolve-Path -LiteralPath $AppExe).Path
$currentDir = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$oldAppPath = $null
$oldVersion = $null
$oldDir = $null
$deleteOldDir = $false

$registration = Get-ItemProperty -LiteralPath $RegistryPath -ErrorAction SilentlyContinue
if ($registration) {
  $oldAppPath = Get-FullPathOrNull $registration.AppPath
  $oldVersion = $registration.Version
}

if ($oldAppPath -and -not (Test-SamePath $oldAppPath $currentAppPath)) {
  $oldDir = Split-Path -Parent $oldAppPath
  Write-Host "[Zero-Latency Web] Existing registration will be replaced."
  Write-Host "  Old version : $oldVersion"
  Write-Host "  Old app path: $oldAppPath"
  Write-Host "  New app path: $currentAppPath"

  $oldDirSafety = Test-SafeOldAppDirectory $oldAppPath $oldDir $currentDir

  if ($oldDirSafety.Safe) {
    $answer = Read-Host "[Zero-Latency Web] Delete the old app folder after successful registration? This may stop the old tray app. [y/N]"
    $deleteOldDir = $answer -match '^(y|yes)$'
  } else {
    Write-Host "[Zero-Latency Web] Old app folder does not pass the safe auto-delete checks. Leaving it in place."
    if ($oldDirSafety.Missing.Count -gt 0) {
      Write-Host "[Zero-Latency Web] Missing or mismatched expected entries:"
      foreach ($missingEntry in $oldDirSafety.Missing) {
        Write-Host "  - $missingEntry"
      }
    }
  }

  Write-Host ""
}

Write-Host "[Zero-Latency Web] Updating per-user registry registration..."
& $AppExe --install
$installExit = $LASTEXITCODE

Write-Host ""
Write-Host "[Zero-Latency Web] Current registration status:"
$statusOutput = & $AppExe --status
$statusOutput | Write-Host

try {
  $status = $statusOutput | ConvertFrom-Json
  if ($status.nativeMessagingRegistered -ne $true) {
    Write-Host ""
    Write-Host "[Zero-Latency Web] Native Messaging is not registered yet."
    Write-Host "[Zero-Latency Web] Install or enable the browser extension first, then run install-register.cmd again."
    Write-Host "[Zero-Latency Web] The extension cannot wake the local app until this registration exists."
  }
} catch {
  Write-Host "[Zero-Latency Web] Could not parse registration status for Native Messaging diagnostics."
}

Write-Host ""
if ($installExit -ne 0) {
  Write-Host "[Zero-Latency Web] Registration failed with exit code $installExit."
  Read-Host "Press Enter to close"
  exit $installExit
}

if ($deleteOldDir -and $oldDir) {
  try {
    Stop-OldAppProcesses $oldAppPath
    Write-Host "[Zero-Latency Web] Deleting old app folder: $oldDir"
    Remove-Item -LiteralPath $oldDir -Recurse -Force -ErrorAction Stop
    Write-Host "[Zero-Latency Web] Old app folder deleted."
  } catch {
    Write-Host "[Zero-Latency Web] Failed to delete old app folder automatically:"
    Write-Host "  $($_.Exception.Message)"
    Write-Host "[Zero-Latency Web] You can delete it manually after closing the old app."
  }
}

Write-Host "[Zero-Latency Web] Registration updated. You can close this window."
Read-Host "Press Enter to close"
