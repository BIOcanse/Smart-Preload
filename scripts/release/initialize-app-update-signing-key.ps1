param(
  [string]$PrivateKeyPath = (Join-Path $env:USERPROFILE ".smart-preload-release\app-update-signing-private.json"),
  [string]$PublicKeyPath = ""
)

$ErrorActionPreference = "Stop"
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $ScriptRoot "..\.."))

if ([string]::IsNullOrWhiteSpace($PublicKeyPath)) {
  $PublicKeyPath = Join-Path $RepoRoot "app\src\update\signing-public.json"
}

$privateFullPath = [System.IO.Path]::GetFullPath($PrivateKeyPath)
$publicFullPath = [System.IO.Path]::GetFullPath($PublicKeyPath)

if (Test-Path -LiteralPath $privateFullPath) {
  throw "Refusing to overwrite the existing app update signing key: $privateFullPath"
}

try {
  $rsa = New-Object System.Security.Cryptography.RSACng -ArgumentList 3072
} catch {
  $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider -ArgumentList 3072
}
$parameters = $rsa.ExportParameters($true)

function Convert-BytesToBase64([byte[]]$Value) {
  if ($null -eq $Value) { return "" }
  return [Convert]::ToBase64String($Value)
}

$publicIdentityBytes = New-Object byte[] ($parameters.Modulus.Length + $parameters.Exponent.Length)
[Array]::Copy($parameters.Modulus, 0, $publicIdentityBytes, 0, $parameters.Modulus.Length)
[Array]::Copy($parameters.Exponent, 0, $publicIdentityBytes, $parameters.Modulus.Length, $parameters.Exponent.Length)
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$keyId = ([BitConverter]::ToString($sha256.ComputeHash($publicIdentityBytes))).Replace("-", "").ToLowerInvariant().Substring(0, 32)

$privatePayload = [ordered]@{
  schemaVersion = 1
  algorithm = "rsa-pkcs1-sha256"
  keyId = $keyId
  modulus = Convert-BytesToBase64 $parameters.Modulus
  exponent = Convert-BytesToBase64 $parameters.Exponent
  d = Convert-BytesToBase64 $parameters.D
  p = Convert-BytesToBase64 $parameters.P
  q = Convert-BytesToBase64 $parameters.Q
  dp = Convert-BytesToBase64 $parameters.DP
  dq = Convert-BytesToBase64 $parameters.DQ
  inverseQ = Convert-BytesToBase64 $parameters.InverseQ
}
$publicPayload = [ordered]@{
  schemaVersion = 1
  algorithm = "rsa-pkcs1-sha256"
  keyId = $keyId
  modulus = Convert-BytesToBase64 $parameters.Modulus
  exponent = Convert-BytesToBase64 $parameters.Exponent
}

foreach ($path in @($privateFullPath, $publicFullPath)) {
  $directory = Split-Path -Parent $path
  if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
}

$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText(
  $privateFullPath,
  ($privatePayload | ConvertTo-Json -Depth 3),
  $utf8WithoutBom
)
[System.IO.File]::WriteAllText(
  $publicFullPath,
  ($publicPayload | ConvertTo-Json -Depth 3),
  $utf8WithoutBom
)

try {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $acl.SetOwner([System.Security.Principal.NTAccount]$identity)
  $acl.SetAccessRuleProtection($true, $false)
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $identity,
    [System.Security.AccessControl.FileSystemRights]::FullControl,
    [System.Security.AccessControl.AccessControlType]::Allow
  )
  $acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $privateFullPath -AclObject $acl
} catch {
  Remove-Item -LiteralPath $privateFullPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $publicFullPath -Force -ErrorAction SilentlyContinue
  throw "Failed to restrict the private signing key ACL: $($_.Exception.Message)"
}

Write-Output ([pscustomobject]@{
  privateKeyPath = $privateFullPath
  publicKeyPath = $publicFullPath
  keyId = $keyId
})
