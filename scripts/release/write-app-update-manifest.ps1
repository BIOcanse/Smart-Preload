param(
  [Parameter(Mandatory = $true)]
  [string]$AppZip,

  [string]$OutputPath = "",

  [string]$ExpectedVersion = "",

  [string]$SigningKeyPath = (Join-Path $env:USERPROFILE ".smart-preload-release\app-update-signing-private.json")
)

$ErrorActionPreference = "Stop"

$resolvedZip = (Resolve-Path -LiteralPath $AppZip -ErrorAction Stop).Path
if (-not (Test-Path -LiteralPath $resolvedZip -PathType Leaf)) {
  throw "App update archive does not exist: $AppZip"
}

$assetName = Split-Path -Leaf $resolvedZip
$assetPattern = '^zero-latency-web-app-windows-x64-v(?<version>[0-9]+\.[0-9]+\.[0-9]+)\.zip$'
$assetMatch = [regex]::Match($assetName, $assetPattern)
if (-not $assetMatch.Success) {
  throw "App update archive name is not canonical: $assetName"
}

if (-not [string]::IsNullOrWhiteSpace($ExpectedVersion) -and $assetMatch.Groups['version'].Value -ne $ExpectedVersion.TrimStart('v')) {
  throw "App update archive version $($assetMatch.Groups['version'].Value) does not match expected version $ExpectedVersion"
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = "$resolvedZip.sha256.txt"
}

$outputFullPath = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $outputFullPath
if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
  New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}

$hash = (Get-FileHash -LiteralPath $resolvedZip -Algorithm SHA256).Hash.ToLowerInvariant()
$manifestLine = "$hash  $assetName`r`n"
$temporaryPath = "$outputFullPath.$PID.tmp"
$signaturePath = "$outputFullPath.sig"
$signatureTemporaryPath = "$signaturePath.$PID.tmp"

try {
  [System.IO.File]::WriteAllText($temporaryPath, $manifestLine, [System.Text.Encoding]::ASCII)
  Move-Item -LiteralPath $temporaryPath -Destination $outputFullPath -Force

  $resolvedSigningKey = (Resolve-Path -LiteralPath $SigningKeyPath -ErrorAction Stop).Path
  $signingKey = Get-Content -LiteralPath $resolvedSigningKey -Raw | ConvertFrom-Json
  if ($signingKey.schemaVersion -ne 1 -or $signingKey.algorithm -ne "rsa-pkcs1-sha256" -or [string]::IsNullOrWhiteSpace($signingKey.keyId)) {
    throw "App update signing key metadata is invalid."
  }

  function Convert-Base64ToBytes([string]$Value, [string]$FieldName) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
      throw "App update signing key field is missing: $FieldName"
    }
    try {
      return [Convert]::FromBase64String($Value)
    } catch {
      throw "App update signing key field is invalid: $FieldName"
    }
  }

  $parameters = New-Object System.Security.Cryptography.RSAParameters
  $parameters.Modulus = Convert-Base64ToBytes $signingKey.modulus "modulus"
  $parameters.Exponent = Convert-Base64ToBytes $signingKey.exponent "exponent"
  $parameters.D = Convert-Base64ToBytes $signingKey.d "d"
  $parameters.P = Convert-Base64ToBytes $signingKey.p "p"
  $parameters.Q = Convert-Base64ToBytes $signingKey.q "q"
  $parameters.DP = Convert-Base64ToBytes $signingKey.dp "dp"
  $parameters.DQ = Convert-Base64ToBytes $signingKey.dq "dq"
  $parameters.InverseQ = Convert-Base64ToBytes $signingKey.inverseQ "inverseQ"

  try {
    $rsa = New-Object System.Security.Cryptography.RSACng
  } catch {
    $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider
  }
  $rsa.ImportParameters($parameters)
  $manifestBytes = [System.IO.File]::ReadAllBytes($outputFullPath)
  $signatureBytes = $rsa.SignData(
    $manifestBytes,
    [System.Security.Cryptography.HashAlgorithmName]::SHA256,
    [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
  )
  $signaturePayload = [ordered]@{
    schemaVersion = 1
    algorithm = "rsa-pkcs1-sha256"
    keyId = [string]$signingKey.keyId
    signature = [Convert]::ToBase64String($signatureBytes)
  }
  [System.IO.File]::WriteAllText(
    $signatureTemporaryPath,
    ($signaturePayload | ConvertTo-Json -Compress),
    [System.Text.Encoding]::ASCII
  )
  Move-Item -LiteralPath $signatureTemporaryPath -Destination $signaturePath -Force
} finally {
  if (Test-Path -LiteralPath $temporaryPath) {
    Remove-Item -LiteralPath $temporaryPath -Force
  }
  if (Test-Path -LiteralPath $signatureTemporaryPath) {
    Remove-Item -LiteralPath $signatureTemporaryPath -Force
  }
}

Write-Output ([pscustomobject]@{
  manifestPath = $outputFullPath
  signaturePath = $signaturePath
  keyId = [string]$signingKey.keyId
})
