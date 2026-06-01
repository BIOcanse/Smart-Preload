#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod api;
mod lifecycle;
mod runtime_debug;
mod telemetry;
mod tray;
mod window;

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

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
        AppMode::Install => print_lifecycle_status(lifecycle::install_portable_app()?),
        AppMode::NativeMessaging => lifecycle::run_native_messaging_host(),
        AppMode::Status => print_lifecycle_status(lifecycle::portable_install_status()?),
        AppMode::Uninstall => print_lifecycle_status(lifecycle::uninstall_portable_app()?),
        AppMode::Watcher => lifecycle::cleanup_legacy_watcher_mode(),
        AppMode::Auto => run_auto_mode(),
        AppMode::Host => run_host(),
    }
}

fn print_lifecycle_status(status: lifecycle::PortableInstallStatus) -> Result<()> {
    lifecycle::write_portable_install_status_snapshot(&status)?;
    println!("{}", serde_json::to_string_pretty(&status)?);
    Ok(())
}

fn run_auto_mode() -> Result<()> {
    record_app_runtime_event("host", "auto-mode-entered", None);
    lifecycle::disable_watcher_registration()?;

    let debug_force_host = lifecycle::debug_force_host_enabled();

    if debug_force_host {
        record_app_runtime_event("host", "auto-debug-force-host", None);
        info!(
            "debug-force-host is enabled; bypassing extension-install gate for local host startup"
        );
        return run_host();
    }

    record_app_runtime_event("host", "auto-skip-native-wake-required", None);
    info!("Local host now starts only through Native Messaging wake or explicit --host.");
    Ok(())
}

fn run_host() -> Result<()> {
    record_app_runtime_event("host", "host-mode-entered", None);
    let debug_force_host = lifecycle::debug_force_host_enabled();
    let native_wake_host = lifecycle::consume_recent_native_wake_marker();
    let _host_guard = match lifecycle::acquire_host_guard()? {
        Some(guard) => guard,
        None => {
            record_app_runtime_event("host", "host-duplicate-instance-exit", None);
            info!("tray host instance already running; exiting duplicate host");
            return Ok(());
        }
    };

    let target_extension_installed = lifecycle::target_extension_is_installed();

    if !target_extension_installed && !debug_force_host && !native_wake_host {
        record_app_runtime_event("host", "host-skip-extension-missing", None);
        info!("target extension is not installed; exiting host");
        return Ok(());
    }

    if native_wake_host && !target_extension_installed {
        record_app_runtime_event(
            "host",
            "host-native-wake-bypass-initial-extension-scan",
            None,
        );
        info!("host was woken through Native Messaging; bypassing only the initial extension scan");
    }

    let snapshotter = Arc::new(Mutex::new(SystemSnapshotter::new()?));
    let state = ApiState::new(snapshotter);
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let server_handle = api::spawn_server(state.clone(), shutdown_rx);
    let tray_shutdown_rx = shutdown_tx.subscribe();
    lifecycle::spawn_chrome_shutdown_monitor(shutdown_tx.clone());

    if debug_force_host {
        record_app_runtime_event("host", "extension-monitor-skipped-debug-force", None);
    } else {
        lifecycle::spawn_extension_shutdown_monitor(shutdown_tx.clone());
        spawn_extension_heartbeat_shutdown_monitor(state.clone(), shutdown_tx.clone());
    }

    record_app_runtime_event("host", "host-ready", None);
    info!("Zero-Latency Web local hardware API is running in the tray.");
    let tray_result = tray::run_tray(shutdown_tx.clone(), tray_shutdown_rx);
    let _ = shutdown_tx.send(true);
    let closed_hidden_window_count = window::close_tracked_hidden_windows("host-shutdown");

    if closed_hidden_window_count > 0 {
        record_app_runtime_event(
            "host",
            "host-shutdown-closed-hidden-windows",
            Some(format!("count={closed_hidden_window_count}")),
        );
    }

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

fn spawn_extension_heartbeat_shutdown_monitor(state: ApiState, shutdown_tx: watch::Sender<bool>) {
    const NO_NORMAL_WINDOW_GRACE: Duration = Duration::from_secs(90);
    const HEARTBEAT_CHECK_INTERVAL: Duration = Duration::from_secs(5);

    thread::spawn(move || {
        let started_at = Instant::now();
        let mut last_normal_window_seen_at = Instant::now();
        let shutdown_rx = shutdown_tx.subscribe();
        let mut last_logged_activity: Option<(usize, usize, usize, usize, usize)> = None;

        record_app_runtime_event("host", "extension-heartbeat-monitor-started", None);

        loop {
            if *shutdown_rx.borrow() {
                break;
            }

            let active_count = state.active_extension_heartbeat_count(api::EXTENSION_HEARTBEAT_TTL);
            let reported_normal_window_count =
                state.active_extension_normal_window_count(api::EXTENSION_HEARTBEAT_TTL);
            let window_report_count =
                state.active_extension_window_report_count(api::EXTENSION_HEARTBEAT_TTL);
            let visible_browser_window_count = count_visible_user_browser_windows();
            let active_normal_window_count = reported_normal_window_count;

            if active_normal_window_count > 0 {
                last_normal_window_seen_at = Instant::now();
            }

            if last_logged_activity
                != Some((
                    active_count,
                    active_normal_window_count,
                    reported_normal_window_count,
                    window_report_count,
                    visible_browser_window_count,
                ))
            {
                record_app_runtime_event(
                    "host",
                    "extension-heartbeat-active-count",
                    Some(format!(
                        "active={active_count}::normalWindows={active_normal_window_count}::reportedNormalWindows={reported_normal_window_count}::windowReports={window_report_count}::visibleBrowserWindows={visible_browser_window_count}"
                    )),
                );
                last_logged_activity = Some((
                    active_count,
                    active_normal_window_count,
                    reported_normal_window_count,
                    window_report_count,
                    visible_browser_window_count,
                ));
            }

            if active_count == 0 && started_at.elapsed() >= NO_NORMAL_WINDOW_GRACE {
                record_app_runtime_event("host", "extension-heartbeat-timeout-shutdown", None);
                let _ = shutdown_tx.send(true);
                break;
            }

            if active_count > 0
                && active_normal_window_count == 0
                && started_at.elapsed() >= NO_NORMAL_WINDOW_GRACE
                && last_normal_window_seen_at.elapsed() >= NO_NORMAL_WINDOW_GRACE
            {
                record_app_runtime_event("host", "extension-no-normal-window-shutdown", None);
                let _ = shutdown_tx.send(true);
                break;
            }

            for _ in 0..(HEARTBEAT_CHECK_INTERVAL.as_millis() / 100) {
                if *shutdown_rx.borrow() {
                    return;
                }

                thread::sleep(Duration::from_millis(100));
            }
        }
    });
}

fn count_visible_user_browser_windows() -> usize {
    crate::window::list_chrome_windows()
        .into_iter()
        .filter(|window| window.visible && !window.tool_window)
        .count()
}
