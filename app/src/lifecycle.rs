mod chrome;
mod host;
mod native_messaging;
mod watcher;

use std::env;
use std::fs;
use std::path::PathBuf;
use std::thread;
use std::time::Duration;

use anyhow::{Context, Result};
use single_instance::SingleInstance;
use sysinfo::System;
use tokio::sync::watch;
use tracing::info;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

use crate::telemetry::is_google_chrome_browser_process;

const WATCHER_ARGUMENT: &str = "--watcher";
const HOST_ARGUMENT: &str = "--host";
const NATIVE_MESSAGING_HOST_NAME: &str = "com.zero_latency_web.app";
const HOST_INSTANCE_NAME: &str = "ZeroLatencyWebHost";
const RUN_VALUE_NAME: &str = "ZeroLatencyWebWatcher";
const RUN_KEY_PATH: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const EXTENSION_INSTALL_CHECK_INTERVAL: Duration = Duration::from_secs(15);
const CHROME_EXIT_GRACE_TICKS: u8 = 3;
const CHROME_USER_DATA_RELATIVE_PATH: &str = "Google\\Chrome\\User Data";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppMode {
    Auto,
    Host,
    NativeMessaging,
    Watcher,
}

pub fn current_mode() -> AppMode {
    let mut args = env::args().skip(1);

    match args.next().as_deref() {
        Some(WATCHER_ARGUMENT) => AppMode::Watcher,
        Some(HOST_ARGUMENT) => AppMode::Host,
        Some(origin) if origin.starts_with("chrome-extension://") => AppMode::NativeMessaging,
        _ => AppMode::Auto,
    }
}

pub(crate) use chrome::{chrome_is_running, spawn_chrome_shutdown_monitor};
pub(crate) use host::{
    acquire_host_guard, spawn_extension_shutdown_monitor, target_extension_is_installed,
};
pub(crate) use native_messaging::{
    cleanup_native_messaging_registration, run_native_messaging_host,
};
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

pub(crate) fn debug_force_host_enabled() -> bool {
    // Debug force must not be persisted in the portable app directory. A stale file there
    // can bypass the extension-install gate after the extension is uninstalled.
    env::var("ZLW_DEBUG_FORCE_HOST")
        .ok()
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn chrome_user_data_root() -> Option<PathBuf> {
    let local_app_data = env::var_os("LOCALAPPDATA")?;
    let root = PathBuf::from(local_app_data).join(CHROME_USER_DATA_RELATIVE_PATH);
    root.is_dir().then_some(root)
}
