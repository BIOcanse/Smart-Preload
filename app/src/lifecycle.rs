mod chrome;
mod extension;
mod host;
mod install;
mod native_messaging;
mod watcher;

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, SystemTime};

use anyhow::{Context, Result};
use single_instance::SingleInstance;
use tokio::sync::watch;
use tracing::info;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

use crate::telemetry::{
    is_google_chrome_browser_process, SystemProcessSampler, PROCESS_SAMPLE_MAX_AGE,
};

const WATCHER_ARGUMENT: &str = "--watcher";
const HOST_ARGUMENT: &str = "--host";
const INSTALL_ARGUMENT: &str = "--install";
const UNINSTALL_ARGUMENT: &str = "--uninstall";
const STATUS_ARGUMENT: &str = "--status";
const NATIVE_MESSAGING_HOST_NAME: &str = "com.zero_latency_web.app";
const HOST_INSTANCE_NAME: &str = "ZeroLatencyWebHost";
const APP_REGISTRY_PATH: &str = "Software\\ZeroLatencyWeb";
const RUN_VALUE_NAME: &str = "ZeroLatencyWebWatcher";
const RUN_KEY_PATH: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const EXTENSION_INSTALL_CHECK_INTERVAL: Duration = Duration::from_secs(15);
const CHROME_EXIT_GRACE_TICKS: u8 = 3;
const SUPPORTED_BROWSER_USER_DATA_RELATIVE_PATHS: [&str; 2] =
    ["Google\\Chrome\\User Data", "Microsoft\\Edge\\User Data"];
const NATIVE_WAKE_MARKER_FILE: &str = "native-wake.marker";
const NATIVE_WAKE_MARKER_GRACE: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppMode {
    Auto,
    Host,
    Install,
    NativeMessaging,
    Status,
    Uninstall,
    Watcher,
}

pub fn current_mode() -> AppMode {
    let mut args = env::args().skip(1);

    match args.next().as_deref() {
        Some(WATCHER_ARGUMENT) => AppMode::Watcher,
        Some(HOST_ARGUMENT) => AppMode::Host,
        Some(INSTALL_ARGUMENT) => AppMode::Install,
        Some(UNINSTALL_ARGUMENT) => AppMode::Uninstall,
        Some(STATUS_ARGUMENT) => AppMode::Status,
        Some(origin) if origin.starts_with("chrome-extension://") => AppMode::NativeMessaging,
        _ => AppMode::Auto,
    }
}

pub(crate) use chrome::spawn_chrome_shutdown_monitor;
pub(crate) use extension::{
    registered_extension_ids, spawn_extension_shutdown_monitor, target_extension_disabled_ids,
    target_extension_enabled_ids, target_extension_id, target_extension_ids,
    target_extension_is_installed, target_extension_origin_is_installed,
};
pub(crate) use host::acquire_host_guard;
pub(crate) use install::{
    install_portable_app, portable_install_status, uninstall_portable_app,
    write_portable_install_status_snapshot, PortableInstallStatus,
};
pub(crate) use native_messaging::run_native_messaging_host;
pub(crate) use watcher::{cleanup_legacy_watcher_mode, disable_watcher_registration};

pub(crate) fn request_manual_host_exit(shutdown_tx: &watch::Sender<bool>) {
    let _ = shutdown_tx.send(true);
}

fn current_executable() -> Result<PathBuf> {
    env::current_exe().context("failed to resolve current executable path")
}

fn portable_path(file_name: &str) -> Result<PathBuf> {
    let executable_path = current_executable()?;
    let executable_dir = executable_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("local app executable directory is not available"))?;
    Ok(executable_dir.join("portable").join(file_name))
}

fn ensure_portable_parent_dir(path: &Path) -> Result<()> {
    if let Some(parent_dir) = path.parent() {
        fs::create_dir_all(parent_dir)?;
    }
    Ok(())
}

pub(crate) fn debug_force_host_enabled() -> bool {
    // Debug force must not be persisted in the portable app directory. A stale file there
    // can bypass the extension-install gate after the extension is uninstalled.
    env::var("ZLW_DEBUG_FORCE_HOST")
        .ok()
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

pub(crate) fn write_native_wake_marker() -> Result<()> {
    let marker_path = portable_path(NATIVE_WAKE_MARKER_FILE)?;
    ensure_portable_parent_dir(&marker_path)?;
    fs::write(marker_path, b"native-wake")?;
    Ok(())
}

pub(crate) fn consume_recent_native_wake_marker() -> bool {
    let Ok(marker_path) = portable_path(NATIVE_WAKE_MARKER_FILE) else {
        return false;
    };
    let Ok(metadata) = fs::metadata(&marker_path) else {
        return false;
    };
    let modified_at = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
    let recent = modified_at
        .elapsed()
        .map(|elapsed| elapsed <= NATIVE_WAKE_MARKER_GRACE)
        .unwrap_or(false);

    let _ = fs::remove_file(marker_path);
    recent
}

fn browser_user_data_roots() -> Vec<PathBuf> {
    let Some(local_app_data) = env::var_os("LOCALAPPDATA") else {
        return Vec::new();
    };
    let local_app_data = PathBuf::from(local_app_data);

    SUPPORTED_BROWSER_USER_DATA_RELATIVE_PATHS
        .iter()
        .map(|relative_path| local_app_data.join(relative_path))
        .filter(|root| root.is_dir())
        .collect()
}
