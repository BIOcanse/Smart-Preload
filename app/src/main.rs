#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod api;
mod lifecycle;
mod model;
mod runtime_debug;
mod telemetry;
mod tray;
mod window;

use std::sync::{Arc, Mutex};

use anyhow::Result;
use tokio::sync::watch;
use tracing::info;

use crate::api::ApiState;
use crate::lifecycle::AppMode;
use crate::runtime_debug::record_app_runtime_event;
use crate::telemetry::SystemSnapshotter;

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .with_target(false)
        .compact()
        .init();

    match lifecycle::current_mode() {
        AppMode::NativeMessaging => lifecycle::run_native_messaging_host(),
        AppMode::Watcher => lifecycle::cleanup_legacy_watcher_mode(),
        AppMode::Auto => run_auto_mode(),
        AppMode::Host => run_host(),
    }
}

fn run_auto_mode() -> Result<()> {
    record_app_runtime_event("host", "auto-mode-entered", None);
    lifecycle::cleanup_native_messaging_registration()?;
    let debug_force_host = lifecycle::debug_force_host_enabled();

    if !lifecycle::chrome_is_running() {
        record_app_runtime_event("host", "auto-skip-chrome-offline", None);
        info!("Chrome is not running. Native Messaging registration is ready and tray host stays offline.");
        return Ok(());
    }

    if !lifecycle::target_extension_is_installed() && !debug_force_host {
        record_app_runtime_event("host", "auto-skip-extension-missing", None);
        info!("Chrome is running but the extension is not installed. Tray host stays offline.");
        return Ok(());
    }

    if debug_force_host {
        record_app_runtime_event("host", "auto-debug-force-host", None);
        info!(
            "debug-force-host is enabled; bypassing extension-install gate for local host startup"
        );
    }

    run_host()
}

fn run_host() -> Result<()> {
    record_app_runtime_event("host", "host-mode-entered", None);
    let debug_force_host = lifecycle::debug_force_host_enabled();
    let _host_guard = match lifecycle::acquire_host_guard()? {
        Some(guard) => guard,
        None => {
            record_app_runtime_event("host", "host-duplicate-instance-exit", None);
            info!("tray host instance already running; exiting duplicate host");
            return Ok(());
        }
    };

    if !lifecycle::target_extension_is_installed() && !debug_force_host {
        record_app_runtime_event("host", "host-skip-extension-missing", None);
        info!("extension is not installed; tray host will stay offline");
        return Ok(());
    }

    let snapshotter = Arc::new(Mutex::new(SystemSnapshotter::new()?));
    let state = ApiState::new(snapshotter);
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let server_handle = api::spawn_server(state, shutdown_rx);
    let tray_shutdown_rx = shutdown_tx.subscribe();
    lifecycle::spawn_chrome_shutdown_monitor(shutdown_tx.clone());
    if !debug_force_host {
        lifecycle::spawn_extension_shutdown_monitor(shutdown_tx.clone());
    } else {
        record_app_runtime_event("host", "host-skip-extension-monitor-debug", None);
        info!("debug-force-host is enabled; skipping extension shutdown monitor");
    }

    record_app_runtime_event("host", "host-ready", None);
    info!("Zero-Latency Web local hardware API is running in the tray.");
    let tray_result = tray::run_tray(shutdown_tx.clone(), tray_shutdown_rx);
    let _ = shutdown_tx.send(true);
    let _ = model::shutdown_managed_runtimes();

    if let Err(error) = server_handle.join() {
        record_app_runtime_event("host", "api-thread-panic", Some(format!("{error:?}")));
        tracing::error!("API server thread panicked: {:?}", error);
    }

    record_app_runtime_event(
        "host",
        "host-exiting",
        tray_result.as_ref().err().map(|error| error.to_string()),
    );
    tray_result
}
