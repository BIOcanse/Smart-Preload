$ErrorActionPreference = "Stop"

$workspaceRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$crateRoot = Join-Path $workspaceRoot "wasm\visit-graph-engine"
$pkgDir = Join-Path $workspaceRoot "wasm\pkg"
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
$wingetPackages = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
$gccPath = Get-ChildItem $wingetPackages -Recurse -Filter gcc.exe -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -like '*WinLibs.POSIX.UCRT*' } |
  Select-Object -First 1 -ExpandProperty FullName

if (-not $gccPath) {
  throw "gcc.exe not found. Install WinLibs POSIX UCRT first."
}

$gccDir = Split-Path $gccPath -Parent
$env:Path = "$gccDir;$cargoBin;$env:Path"

New-Item -ItemType Directory -Force $pkgDir | Out-Null

Push-Location $crateRoot
try {
  cargo +stable-x86_64-pc-windows-gnu build --target wasm32-unknown-unknown --release

  $wasmSource = Join-Path $crateRoot "target\wasm32-unknown-unknown\release\visit_graph_engine.wasm"
  $wasmTarget = Join-Path $pkgDir "visit_graph_engine.wasm"

  Copy-Item $wasmSource $wasmTarget -Force
  Write-Output "Built wasm module: $wasmTarget"
} finally {
  Pop-Location
}
