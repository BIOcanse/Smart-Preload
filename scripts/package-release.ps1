param(
  [string]$Version = "",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $ScriptRoot ".."))
$ExtensionRoot = Join-Path $RepoRoot "extansion"
$AppRoot = Join-Path $RepoRoot "app"
$DistRoot = Join-Path $RepoRoot "dist"
$LicensePath = Join-Path $RepoRoot "LICENSE"
$NoticePath = Join-Path $RepoRoot "NOTICE"

if ([string]::IsNullOrWhiteSpace($Version)) {
  $manifest = Get-Content -LiteralPath (Join-Path $ExtensionRoot "manifest.json") -Raw | ConvertFrom-Json
  $Version = [string]$manifest.version
}

if ([string]::IsNullOrWhiteSpace($Version)) {
  throw "Version was not provided and could not be read from extansion\manifest.json."
}

$DistFull = [System.IO.Path]::GetFullPath($DistRoot).TrimEnd('\') + '\'
$StagingRoot = Join-Path $DistRoot "staging\release-v$Version"
$ExtensionStage = Join-Path $StagingRoot "zero-latency-web-extension-v$Version"
$AppStage = Join-Path $StagingRoot "zero-latency-web-app-v$Version"
$ReviewStage = Join-Path $StagingRoot "zero-latency-web-chrome-review-bundle-v$Version"
$ReleaseStage = Join-Path $StagingRoot "zero-latency-web-release-v$Version"
$TestStage = Join-Path $StagingRoot "zero-latency-web-test-bundle-v$Version"

$ExtensionZip = Join-Path $DistRoot "zero-latency-web-extension-v$Version.zip"
$ChromeStoreZip = Join-Path $DistRoot "zero-latency-web-extension-chrome-web-store-v$Version.zip"
$AppZip = Join-Path $DistRoot "zero-latency-web-app-windows-x64-v$Version.zip"
$ReviewZip = Join-Path $DistRoot "zero-latency-web-chrome-review-bundle-v$Version.zip"
$ReleaseZip = Join-Path $DistRoot "zero-latency-web-release-v$Version.zip"
$TestZip = Join-Path $DistRoot "zero-latency-web-test-bundle-v$Version.zip"
$ShaFile = Join-Path $DistRoot "SHA256SUMS-v$Version.txt"

function Assert-DistPath {
  param([string]$Path)

  $full = [System.IO.Path]::GetFullPath($Path)
  if (-not ($full.StartsWith($DistFull, [System.StringComparison]::OrdinalIgnoreCase))) {
    throw "Refusing to operate outside dist: $full"
  }
}

function Remove-DistPathIfExists {
  param([string]$Path)

  Assert-DistPath $Path
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

function New-CleanDirectory {
  param([string]$Path)

  Remove-DistPathIfExists $Path
  New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

function Copy-Directory {
  param(
    [string]$Source,
    [string]$Destination
  )

  if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    throw "Missing directory: $Source"
  }

  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  Copy-Item -Path (Join-Path $Source "*") -Destination $Destination -Recurse -Force
}

function Copy-File {
  param(
    [string]$Source,
    [string]$Destination
  )

  if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) {
    throw "Missing file: $Source"
  }

  $parent = Split-Path -Parent $Destination
  if ($parent) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

function New-ZipFromDirectoryContents {
  param(
    [string]$SourceDirectory,
    [string]$ZipPath
  )

  Remove-DistPathIfExists $ZipPath
  Compress-Archive -Path (Join-Path $SourceDirectory "*") -DestinationPath $ZipPath -CompressionLevel Optimal
}

function Write-TextFile {
  param(
    [string]$Path,
    [string]$Content
  )

  $parent = Split-Path -Parent $Path
  if ($parent) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }

  Set-Content -LiteralPath $Path -Value $Content -Encoding UTF8
}

function Assert-NoForbiddenRuntimeFiles {
  param([string]$Directory)

  $forbidden = Get-ChildItem -LiteralPath $Directory -Recurse -Force |
    Where-Object {
      $_.Name -in @(
        "debug-api-token.txt",
        "install-status.json",
        "app-runtime-events.jsonl",
        "allowed-extension-origin.txt",
        "allowed-extension-origins.txt"
      ) -or
      $_.FullName -match "\\portable\\logs(\\|$)"
    }

  if ($forbidden.Count -gt 0) {
    $list = ($forbidden | ForEach-Object { $_.FullName }) -join "`n"
    throw "Release package contains runtime-only files:`n$list"
  }
}

if (-not $SkipBuild) {
  & (Join-Path $ExtensionRoot "scripts\build-wasm.ps1")
  Push-Location $AppRoot
  try {
    cargo build --release
  } finally {
    Pop-Location
  }
}

New-Item -ItemType Directory -Path $DistRoot -Force | Out-Null
New-CleanDirectory $StagingRoot

New-CleanDirectory $ExtensionStage
Copy-File $LicensePath (Join-Path $ExtensionStage "LICENSE")
Copy-File $NoticePath (Join-Path $ExtensionStage "NOTICE")
Copy-File (Join-Path $ExtensionRoot "manifest.json") (Join-Path $ExtensionStage "manifest.json")
Copy-File (Join-Path $ExtensionRoot "service-worker.js") (Join-Path $ExtensionStage "service-worker.js")
Copy-File (Join-Path $ExtensionRoot "service-worker-scripts.js") (Join-Path $ExtensionStage "service-worker-scripts.js")
Copy-Directory (Join-Path $ExtensionRoot "_locales") (Join-Path $ExtensionStage "_locales")
Copy-Directory (Join-Path $ExtensionRoot "background") (Join-Path $ExtensionStage "background")
Copy-Directory (Join-Path $ExtensionRoot "popup") (Join-Path $ExtensionStage "popup")
Copy-Directory (Join-Path $ExtensionRoot "settings") (Join-Path $ExtensionStage "settings")
Copy-Directory (Join-Path $ExtensionRoot "shared") (Join-Path $ExtensionStage "shared")
Copy-Directory (Join-Path $ExtensionRoot "scripts\navigation") (Join-Path $ExtensionStage "scripts\navigation")
Copy-File (Join-Path $ExtensionRoot "scripts\navigation-interceptor.js") (Join-Path $ExtensionStage "scripts\navigation-interceptor.js")
Copy-Directory (Join-Path $ExtensionRoot "wasm\pkg") (Join-Path $ExtensionStage "wasm\pkg")
if (Test-Path -LiteralPath (Join-Path $ExtensionRoot "images") -PathType Container) {
  Copy-Directory (Join-Path $ExtensionRoot "images") (Join-Path $ExtensionStage "images")
}

$manifestCheck = Get-Content -LiteralPath (Join-Path $ExtensionStage "manifest.json") -Raw | ConvertFrom-Json
if ($manifestCheck.version -ne $Version) {
  throw "Extension manifest version $($manifestCheck.version) does not match requested version $Version."
}

New-CleanDirectory $AppStage
$CargoTargetDirectory = $null
$CargoConfigPath = Join-Path $AppRoot ".cargo\config.toml"
if (Test-Path -LiteralPath $CargoConfigPath -PathType Leaf) {
  $targetDirLine = Select-String -LiteralPath $CargoConfigPath -Pattern 'target-dir\s*=\s*"([^"]+)"' | Select-Object -First 1
  if ($targetDirLine -and $targetDirLine.Matches.Count -gt 0) {
    $CargoTargetDirectory = $targetDirLine.Matches[0].Groups[1].Value
    if (-not [System.IO.Path]::IsPathRooted($CargoTargetDirectory)) {
      $CargoTargetDirectory = Join-Path $AppRoot $CargoTargetDirectory
    }
  }
}
if ([string]::IsNullOrWhiteSpace($CargoTargetDirectory)) {
  $CargoMetadata = cargo metadata --format-version 1 --no-deps --manifest-path (Join-Path $AppRoot "Cargo.toml") | ConvertFrom-Json
  $CargoTargetDirectory = [string]$CargoMetadata.target_directory
}
$AppExe = Join-Path ([System.IO.Path]::GetFullPath($CargoTargetDirectory)) "release\zero-latency-web-app.exe"
$appReadme = @"
# Smart Preload Windows App

This optional Windows app improves Smart Preload's local browser integration.

First setup:
1. Install or enable the Smart Preload extension in Chrome or Edge.
2. Run install-register.cmd from this folder.
3. Keep this folder in its final location. Run install-register.cmd again if you move it.

After the first successful binding, the extension can reconnect to the app automatically.

Platform: Windows only.

License: Apache License 2.0. See LICENSE and NOTICE.
"@

Copy-File $AppExe (Join-Path $AppStage "zero-latency-web-app.exe")
Copy-File (Join-Path $AppRoot "install-register.cmd") (Join-Path $AppStage "install-register.cmd")
Copy-File (Join-Path $AppRoot "install-register.ps1") (Join-Path $AppStage "install-register.ps1")
Copy-File $LicensePath (Join-Path $AppStage "LICENSE")
Copy-File $NoticePath (Join-Path $AppStage "NOTICE")
Write-TextFile (Join-Path $AppStage "README.md") $appReadme
Write-TextFile (Join-Path $AppStage "VERSION.txt") $Version
New-Item -ItemType Directory -Path (Join-Path $AppStage "portable\native-messaging") -Force | Out-Null
Assert-NoForbiddenRuntimeFiles $AppStage

New-ZipFromDirectoryContents $ExtensionStage $ExtensionZip
Copy-Item -LiteralPath $ExtensionZip -Destination $ChromeStoreZip -Force
New-ZipFromDirectoryContents $AppStage $AppZip

$reviewInstructions = @"
# Smart Preload v$Version - Chrome Web Store review notes

Upload package:
- zero-latency-web-extension-chrome-web-store-v$Version.zip

Native app package for reviewer testing:
- zero-latency-web-app-windows-x64-v$Version.zip

Reviewer setup:
1. Install the Smart Preload extension from the submitted Chrome Web Store package.
2. Extract the native app zip to a normal writable folder.
3. Run install-register.cmd in the extracted native app folder.
4. Open Chrome or Edge, then use regular web pages to verify prediction/preload behavior.
5. The native app is a Windows-only local tray/API helper. It exposes local endpoints only on 127.0.0.1:45831 and only accepts extension origins or an explicit local debug token.

Important setup order:
- For the first binding, install or enable the browser extension before running install-register.cmd or starting the native app.
- After binding succeeds, the extension can wake the native app automatically when the app is offline.

Native app scope:
- Native Messaging wake bridge and liveness heartbeat.
- Per-user HKCU registration for the native messaging host.
- Window hide/show support for background preload windows.
- System activity and performance telemetry for local-only preload pressure hints.
- Tray menu and lifecycle control.

Extension-owned logic:
- Visit graph learning.
- Link scoring and preload scheduling.
- Navigation interception and hidden-tab/native preload activation.
- AI provider calls and API key storage.

No remote hosted extension code is used. The extension package contains the executable extension JavaScript and the local wasm engine needed for graph queries.
"@

$releaseReadme = @"
# Smart Preload v$Version

Contents:
- zero-latency-web-extension-v$Version.zip
- zero-latency-web-app-windows-x64-v$Version.zip
- SHA256SUMS.txt
- LICENSE
- NOTICE

Smart Preload prepares pages you are likely to open next so browsing can feel faster, especially when working across many tabs.

Install:
1. Install or load the extension package in Chrome or Edge.
2. If you want the Windows companion app, extract the Windows app package.
3. Run install-register.cmd from the extracted app folder.
4. Keep the app folder in its final location. Run install-register.cmd again if the folder is moved.

First setup order:
- Install or enable the browser extension before running the Windows app for the first time.
- After the first successful binding, later launches can reconnect automatically.

Platform:
- Extension: Chrome and Edge.
- Companion app: Windows only.

The SHA256SUMS.txt file can be used to verify the downloaded zip files.

License: Apache License 2.0. See LICENSE and NOTICE.
"@

$testGuide = @"
# Smart Preload v$Version test bundle

Recommended smoke checks:
1. Install the extension package.
2. Extract and register the native app package with install-register.cmd.
3. Confirm /health is reachable from the extension.
4. Confirm app and extension heartbeat stay online.
5. Test normal preload activation on several navigation-friendly sites.
6. Test Chrome/Chromium and Edge in parallel.
7. Test incognito behavior with the incognito exclusion setting both enabled and disabled.
8. Test resource-pressure policy with the fullscreen/game policy set to sleep.
9. Confirm popup and settings show the performance warning only when the local app reports pressure without an external workload.

This bundle is for internal QA and reviewer handoff. Runtime logs and debug tokens are intentionally excluded from the app package.

First binding order: install or enable the browser extension first, then run install-register.cmd or start the native app. After binding succeeds, the extension can wake the native app automatically.

License: Apache License 2.0. See LICENSE and NOTICE.
"@

New-CleanDirectory $ReviewStage
New-Item -ItemType Directory -Path (Join-Path $ReviewStage "chrome-web-store-upload") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $ReviewStage "native-app-reviewer-bundle") -Force | Out-Null
Copy-File $ChromeStoreZip (Join-Path $ReviewStage "chrome-web-store-upload\zero-latency-web-extension-chrome-web-store-v$Version.zip")
Copy-File $AppZip (Join-Path $ReviewStage "native-app-reviewer-bundle\zero-latency-web-app-windows-x64-v$Version.zip")
Copy-File $LicensePath (Join-Path $ReviewStage "LICENSE")
Copy-File $NoticePath (Join-Path $ReviewStage "NOTICE")
Write-TextFile (Join-Path $ReviewStage "REVIEW-INSTRUCTIONS.md") $reviewInstructions

New-CleanDirectory $ReleaseStage
Copy-File $ExtensionZip (Join-Path $ReleaseStage "zero-latency-web-extension-v$Version.zip")
Copy-File $AppZip (Join-Path $ReleaseStage "zero-latency-web-app-windows-x64-v$Version.zip")
Copy-File $LicensePath (Join-Path $ReleaseStage "LICENSE")
Copy-File $NoticePath (Join-Path $ReleaseStage "NOTICE")
Write-TextFile (Join-Path $ReleaseStage "README.md") $releaseReadme

New-CleanDirectory $TestStage
Copy-Directory $ExtensionStage (Join-Path $TestStage "zero-latency-web-extension-v$Version")
Copy-Directory $AppStage (Join-Path $TestStage "zero-latency-web-app-v$Version")
Copy-File $ExtensionZip (Join-Path $TestStage "zero-latency-web-extension-v$Version.zip")
Copy-File $AppZip (Join-Path $TestStage "zero-latency-web-app-windows-x64-v$Version.zip")
Copy-File $LicensePath (Join-Path $TestStage "LICENSE")
Copy-File $NoticePath (Join-Path $TestStage "NOTICE")
Write-TextFile (Join-Path $TestStage "README-TEST-GUIDE.md") $testGuide

function Get-HashLines {
  param([string[]]$Paths)

  foreach ($zip in $Paths) {
  $hash = Get-FileHash -LiteralPath $zip -Algorithm SHA256
  "$($hash.Hash.ToLowerInvariant())  $(Split-Path -Leaf $zip)"
  }
}

Set-Content -LiteralPath (Join-Path $ReviewStage "SHA256SUMS.txt") -Value (Get-HashLines @($ChromeStoreZip, $AppZip)) -Encoding ASCII
Set-Content -LiteralPath (Join-Path $ReleaseStage "SHA256SUMS.txt") -Value (Get-HashLines @($ExtensionZip, $AppZip)) -Encoding ASCII
Set-Content -LiteralPath (Join-Path $TestStage "SHA256SUMS.txt") -Value (Get-HashLines @($ExtensionZip, $AppZip)) -Encoding ASCII

New-ZipFromDirectoryContents $ReviewStage $ReviewZip
New-ZipFromDirectoryContents $ReleaseStage $ReleaseZip
New-ZipFromDirectoryContents $TestStage $TestZip

$artifactZips = @(
  $ExtensionZip,
  $ChromeStoreZip,
  $AppZip,
  $ReviewZip,
  $ReleaseZip,
  $TestZip
)
$hashLines = Get-HashLines $artifactZips
Set-Content -LiteralPath $ShaFile -Value $hashLines -Encoding ASCII
foreach ($zip in $artifactZips) {
  $hash = Get-FileHash -LiteralPath $zip -Algorithm SHA256
  Set-Content -LiteralPath "$zip.sha256.txt" -Value "$($hash.Hash.ToLowerInvariant())  $(Split-Path -Leaf $zip)" -Encoding ASCII
}

Write-Host "[Smart Preload] Release packages generated for v$Version"
foreach ($zip in $artifactZips) {
  Write-Host "  $zip"
}
Write-Host "  $ShaFile"
