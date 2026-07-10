use std::path::Path;

pub(crate) struct HandoffScriptParameters<'a> {
    pub(crate) host_pid: u32,
    pub(crate) install_dir: &'a Path,
    pub(crate) incoming_dir: &'a Path,
    pub(crate) backup_dir: &'a Path,
    pub(crate) stage_root: &'a Path,
    pub(crate) marker_path: &'a Path,
    pub(crate) readiness_path: &'a Path,
    pub(crate) archive_path: &'a Path,
    pub(crate) manifest_path: &'a Path,
    pub(crate) target_version: &'a str,
}

pub(crate) fn build_handoff_script(parameters: &HandoffScriptParameters<'_>) -> String {
    let install_dir = power_shell_single_quote(&parameters.install_dir.to_string_lossy());
    let incoming_dir = power_shell_single_quote(&parameters.incoming_dir.to_string_lossy());
    let backup_dir = power_shell_single_quote(&parameters.backup_dir.to_string_lossy());
    let stage_root = power_shell_single_quote(&parameters.stage_root.to_string_lossy());
    let marker_path = power_shell_single_quote(&parameters.marker_path.to_string_lossy());
    let readiness_path = power_shell_single_quote(&parameters.readiness_path.to_string_lossy());
    let archive_path = power_shell_single_quote(&parameters.archive_path.to_string_lossy());
    let manifest_path = power_shell_single_quote(&parameters.manifest_path.to_string_lossy());
    let target_version = power_shell_single_quote(parameters.target_version);
    let host_pid = parameters.host_pid;

    format!(
        r#"$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$HostPid = {host_pid}
$InstallDir = {install_dir}
$IncomingDir = {incoming_dir}
$BackupDir = {backup_dir}
$StageRoot = {stage_root}
$MarkerPath = {marker_path}
$ReadinessPath = {readiness_path}
$ArchivePath = {archive_path}
$ManifestPath = {manifest_path}
$TargetVersion = {target_version}
$LogPath = Join-Path $StageRoot 'update.log'
$Committed = $false
$PortableTransferred = $false
$RollbackPortableDir = Join-Path $StageRoot 'rollback-portable'

function Write-UpdateLog([string]$Message) {{
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}}

function Write-UpdateMarker([string]$Phase) {{
  $marker = [ordered]@{{
    schemaVersion = 1
    phase = $Phase
    targetVersion = $TargetVersion
    ownerPid = $PID
    hostPid = $HostPid
    installDir = $InstallDir
    incomingDir = $IncomingDir
    backupDir = $BackupDir
    stageRoot = $StageRoot
    updatedAtUtc = [DateTime]::UtcNow.ToString('o')
  }}
  $marker | ConvertTo-Json -Compress | Set-Content -LiteralPath $MarkerPath -Encoding UTF8
}}

function Invoke-UnattendedRegistration([string]$Directory) {{
  $registerCommand = Join-Path $Directory 'install-register.cmd'
  if (-not (Test-Path -LiteralPath $registerCommand -PathType Leaf)) {{
    throw "missing installer: $registerCommand"
  }}

  $process = Start-Process -FilePath $registerCommand -ArgumentList '--unattended' -WorkingDirectory $Directory -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0) {{
    throw "unattended registration failed with exit code $($process.ExitCode)"
  }}
}}

function Invoke-DirectRegistration([string]$Directory) {{
  $app = Join-Path $Directory 'zero-latency-web-app.exe'
  if (-not (Test-Path -LiteralPath $app -PathType Leaf)) {{
    throw "missing app executable: $app"
  }}

  & $app --install
  if ($LASTEXITCODE -ne 0) {{
    throw "direct registration failed with exit code $LASTEXITCODE"
  }}
}}

function Start-AppHost([string]$Directory) {{
  $app = Join-Path $Directory 'zero-latency-web-app.exe'
  if (-not (Test-Path -LiteralPath $app -PathType Leaf)) {{
    throw "missing app executable: $app"
  }}

  Start-Process -FilePath $app -ArgumentList '--host' -WorkingDirectory $Directory -WindowStyle Hidden | Out-Null
}}

function Remove-PathIfPresent([string]$Path) {{
  if (Test-Path -LiteralPath $Path) {{
    Remove-Item -LiteralPath $Path -Recurse -Force
  }}
}}

try {{
  Write-UpdateMarker 'waiting-for-host'
  Write-UpdateLog "waiting for host process $HostPid"
  Set-Content -LiteralPath $ReadinessPath -Value $PID -Encoding ASCII
  try {{
    Remove-Item -LiteralPath $ArchivePath -Force -ErrorAction Stop
    Remove-Item -LiteralPath $ManifestPath -Force -ErrorAction Stop
    Write-UpdateLog 'verified download payload removed from staging'
  }} catch {{
    Write-UpdateLog "verified payload cleanup deferred: $($_.Exception.Message)"
  }}
  $waitDeadline = [DateTime]::UtcNow.AddSeconds(120)
  while (Get-Process -Id $HostPid -ErrorAction SilentlyContinue) {{
    if ([DateTime]::UtcNow -ge $waitDeadline) {{
      throw "host process $HostPid did not exit before update handoff"
    }}
    Start-Sleep -Milliseconds 200
  }}

  if (-not (Test-Path -LiteralPath $InstallDir -PathType Container)) {{
    throw "current installation directory is missing: $InstallDir"
  }}
  if (-not (Test-Path -LiteralPath $IncomingDir -PathType Container)) {{
    throw "verified incoming directory is missing: $IncomingDir"
  }}
  if (Test-Path -LiteralPath $BackupDir) {{
    throw "backup path already exists: $BackupDir"
  }}

  Write-UpdateMarker 'switching-directories'
  Write-UpdateLog 'moving current installation to rollback backup'
  Move-Item -LiteralPath $InstallDir -Destination $BackupDir

  Write-UpdateLog 'moving verified installation into place'
  Move-Item -LiteralPath $IncomingDir -Destination $InstallDir

  $previousPortableDir = Join-Path $BackupDir 'portable'
  if (Test-Path -LiteralPath $previousPortableDir -PathType Container) {{
    Write-UpdateMarker 'preserving-portable-data'
    Write-UpdateLog 'moving portable data into the updated installation'
    Remove-PathIfPresent (Join-Path $InstallDir 'portable')
    Move-Item -LiteralPath $previousPortableDir -Destination (Join-Path $InstallDir 'portable')
    $PortableTransferred = $true
  }}

  Write-UpdateMarker 'registering'
  Write-UpdateLog 'registering updated app without prompts'
  Invoke-UnattendedRegistration $InstallDir

  Write-UpdateMarker 'starting-updated-host'
  Write-UpdateLog 'starting updated app host'
  Start-AppHost $InstallDir
  $Committed = $true

  Write-UpdateLog 'update committed'
  Remove-Item -LiteralPath $MarkerPath -Force -ErrorAction SilentlyContinue

  try {{
    Remove-PathIfPresent $BackupDir
    Write-UpdateLog 'rollback backup removed'
  }} catch {{
    Write-UpdateLog "update succeeded but backup cleanup failed: $($_.Exception.Message)"
  }}
}} catch {{
  $updateFailure = $_
  Write-UpdateLog "update failed: $($updateFailure.Exception.Message)"

  if (-not $Committed) {{
    try {{
      Write-UpdateMarker 'rolling-back'
      if (Test-Path -LiteralPath $BackupDir -PathType Container) {{
        if ($PortableTransferred -and (Test-Path -LiteralPath (Join-Path $InstallDir 'portable') -PathType Container)) {{
          Remove-PathIfPresent $RollbackPortableDir
          Move-Item -LiteralPath (Join-Path $InstallDir 'portable') -Destination $RollbackPortableDir
        }}
        Remove-PathIfPresent $InstallDir
        Move-Item -LiteralPath $BackupDir -Destination $InstallDir
        if (Test-Path -LiteralPath $RollbackPortableDir -PathType Container) {{
          Remove-PathIfPresent (Join-Path $InstallDir 'portable')
          Move-Item -LiteralPath $RollbackPortableDir -Destination (Join-Path $InstallDir 'portable')
        }}
        Invoke-DirectRegistration $InstallDir
        Start-AppHost $InstallDir
        Write-UpdateLog 'rollback completed and previous host restarted'
      }} else {{
        Write-UpdateLog 'installation switch had not completed; current installation was left unchanged'
      }}

      Remove-PathIfPresent $IncomingDir
      Remove-Item -LiteralPath $MarkerPath -Force -ErrorAction SilentlyContinue
    }} catch {{
      Write-UpdateLog "rollback failed: $($_.Exception.Message)"
      Write-UpdateMarker 'rollback-failed'
      throw "update failed: $($updateFailure.Exception.Message); rollback failed: $($_.Exception.Message)"
    }}
  }}

  throw $updateFailure
}}
"#
    )
}

fn power_shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;

    use super::*;

    #[test]
    fn generated_handoff_checks_unattended_exit_and_contains_rollback() {
        let script = build_handoff_script(&HandoffScriptParameters {
            host_pid: 42,
            install_dir: &PathBuf::from(r"C:\Apps\Smart Preload"),
            incoming_dir: &PathBuf::from(r"C:\Apps\.Smart Preload.incoming"),
            backup_dir: &PathBuf::from(r"C:\Apps\.Smart Preload.backup"),
            stage_root: &PathBuf::from(r"C:\Temp\Smart Preload update"),
            marker_path: &PathBuf::from(r"C:\Temp\update-in-progress.json"),
            readiness_path: &PathBuf::from(r"C:\Temp\handoff-ready.txt"),
            archive_path: &PathBuf::from(r"C:\Temp\app.zip"),
            manifest_path: &PathBuf::from(r"C:\Temp\app.zip.sha256.txt"),
            target_version: "1.2.3",
        });

        assert!(script.contains("-ArgumentList '--unattended'"));
        assert!(script.contains("if ($process.ExitCode -ne 0)"));
        assert!(script.contains("Invoke-DirectRegistration $InstallDir"));
        assert!(script.contains("moving portable data into the updated installation"));
        assert!(script.contains("$RollbackPortableDir"));
        assert!(script.contains("Move-Item -LiteralPath $BackupDir -Destination $InstallDir"));
        assert!(script.contains("Write-UpdateMarker 'rollback-failed'"));
        assert!(!script.contains("Read-Host"));
    }

    #[test]
    fn quotes_paths_for_powershell_literals() {
        assert_eq!(
            power_shell_single_quote("C:\\Owner's App"),
            "'C:\\Owner''s App'"
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn generated_handoff_is_valid_windows_powershell() {
        let root = std::env::temp_dir().join(format!(
            "smart-preload-handoff-script-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create script test directory");
        let script_path = root.join("handoff.ps1");
        let script = build_handoff_script(&HandoffScriptParameters {
            host_pid: 42,
            install_dir: &PathBuf::from(r"C:\Apps\Smart Preload"),
            incoming_dir: &PathBuf::from(r"C:\Apps\.Smart Preload.incoming"),
            backup_dir: &PathBuf::from(r"C:\Apps\.Smart Preload.backup"),
            stage_root: &root,
            marker_path: &root.join("update-in-progress.json"),
            readiness_path: &root.join("handoff-ready.txt"),
            archive_path: &root.join("app.zip"),
            manifest_path: &root.join("app.zip.sha256.txt"),
            target_version: "1.2.3",
        });
        fs::write(&script_path, script).expect("write generated script");

        let output = Command::new("powershell.exe")
            .env("ZLW_HANDOFF_PARSE_PATH", &script_path)
            .arg("-NoLogo")
            .arg("-NoProfile")
            .arg("-NonInteractive")
            .arg("-Command")
            .arg("$tokens = $null; $errors = $null; [System.Management.Automation.Language.Parser]::ParseFile($env:ZLW_HANDOFF_PARSE_PATH, [ref]$tokens, [ref]$errors) | Out-Null; if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }")
            .output()
            .expect("parse generated PowerShell script");

        assert!(
            output.status.success(),
            "PowerShell parser rejected generated script: {}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let _ = fs::remove_dir_all(root);
    }
}
