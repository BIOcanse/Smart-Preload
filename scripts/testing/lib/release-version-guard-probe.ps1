# 从 scripts/package-release.ps1 里**原地取出** Assert-VersionNotReleased 再调用它。
#
# 不复制一份函数体过来：复制出来的副本会和真身各自演化，测试照样绿，护栏照样坏
# —— 这正是这条护栏第一次失效的模式（它查的是本地标签，而已发布记录在远端）。
# 用 AST 定位函数定义，测的就一定是仓库里那一份。
param(
  [Parameter(Mandatory = $true)][string]$ScriptPath,
  [Parameter(Mandatory = $true)][string]$RepoRoot,
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$RepoSlug,
  [string]$Remote = "",
  [switch]$SkipRemote
)

$ErrorActionPreference = "Stop"

$ast = [System.Management.Automation.Language.Parser]::ParseFile(
  (Resolve-Path -LiteralPath $ScriptPath).Path, [ref]$null, [ref]$null)

$definition = $ast.Find({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Assert-VersionNotReleased'
  }, $true)

if (-not $definition) {
  Write-Output "MISSING-FUNCTION"
  exit 3
}

. ([scriptblock]::Create($definition.Extent.Text))

try {
  Assert-VersionNotReleased -Version $Version -RepoRoot $RepoRoot -RepoSlug $RepoSlug `
    -Remote $Remote -SkipRemote:$SkipRemote | Out-Null
  Write-Output "ALLOWED"
} catch {
  Write-Output ("REFUSED: " + $_.Exception.Message)
}
