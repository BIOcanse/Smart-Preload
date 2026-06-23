<#
  Renders every Chrome Web Store asset (per locale) from the HTML templates in src/.
  Dependency-free: uses installed Chrome (headless screenshot at 2x) + .NET System.Drawing
  to flatten/downscale to an exact-size 24-bit PNG with no alpha channel (store-compliant).

  Usage:
    .\render.ps1                          # all templates, all locales -> out/<locale>/<name>.png
    .\render.ps1 -Langs en                # one locale
    .\render.ps1 -Langs en,zh_CN -Templates screenshot-1   # subset
#>
param(
  [string[]]$Langs = @('de','en','es','fr','ja','ko','pt_BR','ru','zh_CN','zh_TW'),
  [string[]]$Templates = @('screenshot-1','screenshot-2','screenshot-3','screenshot-4','screenshot-5','small-tile','marquee'),
  [string]$Chrome = ''
)

Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$srcDir = Join-Path $root 'src'
$outDir = Join-Path $root 'out'
$tmpDir = Join-Path $env:TEMP 'cws-render'
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

# canvas sizes per template
$SIZES = @{
  'screenshot-1' = @(1280, 800); 'screenshot-2' = @(1280, 800); 'screenshot-3' = @(1280, 800);
  'screenshot-4' = @(1280, 800); 'screenshot-5' = @(1280, 800);
  'small-tile' = @(440, 280); 'marquee' = @(1400, 560);
}

# locate Chrome
if (-not $Chrome) {
  $cands = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  )
  $Chrome = $cands | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Chrome) { throw "Chrome not found. Pass -Chrome 'C:\path\to\chrome.exe'." }
Write-Host "Using browser: $Chrome"

function Save-Exact([string]$inPng, [string]$outPng, [int]$w, [int]$h) {
  $src = [System.Drawing.Image]::FromFile($inPng)
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::White)
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $w, $h)), (New-Object System.Drawing.Rectangle(0, 0, $src.Width, $src.Height)), [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose(); $src.Dispose()
  $bmp.Save($outPng, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

foreach ($lang in $Langs) {
  $langOut = Join-Path $outDir $lang
  New-Item -ItemType Directory -Force -Path $langOut | Out-Null
  foreach ($tpl in $Templates) {
    $size = $SIZES[$tpl]; $w = $size[0]; $h = $size[1]
    $htmlPath = Join-Path $srcDir "$tpl.html"
    if (-not (Test-Path $htmlPath)) { Write-Warning "skip missing $tpl"; continue }
    $url = "file:///" + (($htmlPath -replace '\\', '/') -replace ' ', '%20') + "?lang=$lang"
    $tmp = Join-Path $tmpDir "$tpl-$lang.png"
    $args = @(
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
      '--force-device-scale-factor=2', "--window-size=$w,$h",
      "--screenshot=$tmp", $url
    )
    Start-Process -FilePath $Chrome -ArgumentList $args -Wait -NoNewWindow | Out-Null
    if (-not (Test-Path $tmp)) { Write-Warning "no screenshot for $tpl/$lang"; continue }
    $final = Join-Path $langOut "$tpl.png"
    Save-Exact $tmp $final $w $h
    Write-Host "  $lang/$tpl.png  (${w}x${h})"
  }
}
Write-Host "Done -> $outDir"
