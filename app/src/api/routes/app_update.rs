use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::api::ApiState;
use crate::runtime_debug::record_app_runtime_event;

const APP_ASSET_PREFIX: &str = "zero-latency-web-app-windows-x64-v";
const APP_ASSET_SUFFIX: &str = ".zip";
const RELEASE_URL_PREFIX: &str =
    "https://github.com/BIOcanse/Smart-Preload/releases/";
const ASSET_URL_PREFIX: &str =
    "https://github.com/BIOcanse/Smart-Preload/releases/download/";

pub(crate) async fn app_update_status() -> Json<AppUpdateStatusResponse> {
    Json(AppUpdateStatusResponse {
        ok: true,
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        update_supported: cfg!(target_os = "windows"),
        updater_status: if cfg!(target_os = "windows") {
            "ready".to_string()
        } else {
            "unsupported-platform".to_string()
        },
    })
}

pub(crate) async fn request_app_update(
    State(state): State<ApiState>,
    Json(payload): Json<AppUpdateRequest>,
) -> Result<Json<AppUpdateRequestResponse>, (StatusCode, String)> {
    if !cfg!(target_os = "windows") {
        return Err((
            StatusCode::NOT_IMPLEMENTED,
            "native app updater is only supported on Windows".to_string(),
        ));
    }

    validate_update_request(&payload)
        .map_err(|message| (StatusCode::BAD_REQUEST, message.to_string()))?;

    let target_version = normalize_version(&payload.target_version).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            "invalid target version".to_string(),
        )
    })?;
    let updater_script = write_updater_script(&payload, &target_version)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    spawn_updater_script(&updater_script)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    record_app_runtime_event(
        "updater",
        "app-update-started",
        Some(format!("targetVersion={target_version}")),
    );
    state.request_host_shutdown();

    Ok(Json(AppUpdateRequestResponse {
        ok: true,
        accepted: true,
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        target_version,
        updater_status: "started".to_string(),
        message: "native app updater started".to_string(),
    }))
}

fn validate_update_request(payload: &AppUpdateRequest) -> Result<(), &'static str> {
    let current_version = env!("CARGO_PKG_VERSION");
    let target_version =
        normalize_version(&payload.target_version).ok_or("invalid target version")?;

    if compare_versions(&target_version, current_version) <= 0 {
        return Err("target version must be newer than the running app version");
    }

    let expected_asset_name = format!("{APP_ASSET_PREFIX}{target_version}{APP_ASSET_SUFFIX}");
    if payload.asset_name != expected_asset_name {
        return Err("asset name does not match target version");
    }

    if !payload.asset_url.starts_with(ASSET_URL_PREFIX)
        || !payload.asset_url.ends_with(&expected_asset_name)
    {
        return Err("asset URL is not an expected GitHub release app asset");
    }

    if !payload.release_url.starts_with(RELEASE_URL_PREFIX) {
        return Err("release URL is not an expected GitHub release URL");
    }

    Ok(())
}

fn write_updater_script(
    payload: &AppUpdateRequest,
    target_version: &str,
) -> anyhow::Result<PathBuf> {
    let stage_root = update_stage_root(target_version)?;
    fs::create_dir_all(&stage_root)?;

    let install_dir = current_install_dir()?;
    let script_path = stage_root.join("run-native-app-update.ps1");
    let script = build_updater_script(
        std::process::id(),
        &install_dir,
        &stage_root,
        target_version,
        &payload.asset_name,
        &payload.asset_url,
    );

    fs::write(&script_path, script)?;
    Ok(script_path)
}

fn spawn_updater_script(script_path: &Path) -> anyhow::Result<()> {
    let mut command = Command::new("powershell.exe");
    command
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(script_path);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    command.spawn()?;
    Ok(())
}

fn build_updater_script(
    host_pid: u32,
    install_dir: &Path,
    stage_root: &Path,
    target_version: &str,
    asset_name: &str,
    asset_url: &str,
) -> String {
    let install_dir = power_shell_single_quote(&install_dir.to_string_lossy());
    let stage_root = power_shell_single_quote(&stage_root.to_string_lossy());
    let target_version = power_shell_single_quote(target_version);
    let asset_name = power_shell_single_quote(asset_name);
    let asset_url = power_shell_single_quote(asset_url);

    format!(
        r#"$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$HostPid = {host_pid}
$InstallDir = {install_dir}
$StageRoot = {stage_root}
$TargetVersion = {target_version}
$AssetName = {asset_name}
$AssetUrl = {asset_url}
$LogPath = Join-Path $StageRoot 'update.log'

function Write-UpdateLog([string]$Message) {{
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}}

try {{
  New-Item -ItemType Directory -Path $StageRoot -Force | Out-Null
  Write-UpdateLog "downloading $AssetName"
  $ZipPath = Join-Path $StageRoot $AssetName
  Invoke-WebRequest -Uri $AssetUrl -OutFile $ZipPath -UseBasicParsing

  $ExtractDir = Join-Path $StageRoot 'extracted'
  if (Test-Path -LiteralPath $ExtractDir) {{
    Remove-Item -LiteralPath $ExtractDir -Recurse -Force
  }}
  New-Item -ItemType Directory -Path $ExtractDir -Force | Out-Null
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $ExtractDir -Force

  $RequiredFiles = @(
    'zero-latency-web-app.exe',
    'install-register.cmd',
    'install-register.ps1',
    'VERSION.txt'
  )
  foreach ($Name in $RequiredFiles) {{
    if (-not (Test-Path -LiteralPath (Join-Path $ExtractDir $Name) -PathType Leaf)) {{
      throw "missing required file: $Name"
    }}
  }}

  $PackageVersion = (Get-Content -LiteralPath (Join-Path $ExtractDir 'VERSION.txt') -Raw).Trim()
  if ($PackageVersion -ne $TargetVersion) {{
    throw "package version $PackageVersion does not match target $TargetVersion"
  }}

  Write-UpdateLog "waiting for host process $HostPid"
  $Process = Get-Process -Id $HostPid -ErrorAction SilentlyContinue
  if ($Process) {{
    Wait-Process -Id $HostPid -Timeout 60
  }}
  Start-Sleep -Milliseconds 500

  Write-UpdateLog "copying update files"
  Copy-Item -Path (Join-Path $ExtractDir '*') -Destination $InstallDir -Recurse -Force

  Write-UpdateLog "registering updated app"
  $RegisterCommand = Join-Path $InstallDir 'install-register.cmd'
  Start-Process -FilePath $RegisterCommand -WorkingDirectory $InstallDir -WindowStyle Hidden -Wait

  Write-UpdateLog "starting updated app"
  Start-Process -FilePath (Join-Path $InstallDir 'zero-latency-web-app.exe') -ArgumentList '--host' -WorkingDirectory $InstallDir -WindowStyle Hidden
  Write-UpdateLog 'update completed'
}} catch {{
  Write-UpdateLog "update failed: $($_.Exception.Message)"
  throw
}}
"#
    )
}

fn update_stage_root(target_version: &str) -> anyhow::Result<PathBuf> {
    let base_dir = env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir);
    Ok(base_dir
        .join("ZeroLatencyWeb")
        .join("updates")
        .join(format!("v{target_version}")))
}

fn current_install_dir() -> anyhow::Result<PathBuf> {
    let executable_path = env::current_exe()?;
    executable_path
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| anyhow::anyhow!("local app executable directory is not available"))
}

fn power_shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn normalize_version(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_start_matches('v');
    let parts: Vec<&str> = trimmed.split('.').collect();

    if parts.len() != 3
        || parts.iter().any(|part| {
            part.is_empty() || !part.chars().all(|character| character.is_ascii_digit())
        })
    {
        return None;
    }

    Some(trimmed.to_string())
}

fn compare_versions(left: &str, right: &str) -> i32 {
    let left_parts = parse_version_parts(left);
    let right_parts = parse_version_parts(right);

    for index in 0..3 {
        if left_parts[index] != right_parts[index] {
            return left_parts[index] as i32 - right_parts[index] as i32;
        }
    }

    0
}

fn parse_version_parts(value: &str) -> [u32; 3] {
    let mut parts = [0_u32; 3];

    for (index, part) in value.trim_start_matches('v').split('.').take(3).enumerate() {
        parts[index] = part.parse::<u32>().unwrap_or(0);
    }

    parts
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateStatusResponse {
    ok: bool,
    current_version: String,
    update_supported: bool,
    updater_status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateRequest {
    target_version: String,
    asset_name: String,
    asset_url: String,
    release_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateRequestResponse {
    ok: bool,
    accepted: bool,
    current_version: String,
    target_version: String,
    updater_status: String,
    message: String,
}
