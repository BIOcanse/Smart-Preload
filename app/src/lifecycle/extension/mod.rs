mod manifest;
mod profile;
mod scan;
mod storage;

use crate::runtime_debug::record_app_runtime_event;
use profile::chrome_profile_directories;
use scan::{profile_contains_target_extension_id, scan_for_registered_extension};
use storage::{
    is_detected_extension_storage_present, is_valid_extension_id,
    registered_extension_ids_from_allowed_origins,
};

use super::EXTENSION_INSTALL_CHECK_INTERVAL;
use std::collections::BTreeSet;
use std::thread;
use std::time::Duration;
use tokio::sync::watch;
use tracing::info;

pub(crate) fn target_extension_id() -> Option<String> {
    scan_for_registered_extension().extension_id
}

pub(crate) fn target_extension_ids() -> Vec<String> {
    scan_for_registered_extension().extension_ids
}

pub(crate) fn target_extension_enabled_ids() -> Vec<String> {
    scan_for_registered_extension().enabled_extension_ids
}

pub(crate) fn target_extension_disabled_ids() -> Vec<String> {
    scan_for_registered_extension().disabled_extension_ids
}

pub(crate) fn registered_extension_ids() -> Vec<String> {
    registered_extension_ids_from_allowed_origins()
}

pub(crate) fn target_extension_is_installed() -> bool {
    let mut tracker = ExtensionInstallTracker::new();
    tracker.refresh()
}

pub(crate) fn target_extension_origin_is_installed(origin: &str) -> bool {
    let Some(extension_id) = origin
        .trim()
        .strip_prefix("chrome-extension://")
        .filter(|extension_id| is_valid_extension_id(extension_id))
    else {
        return false;
    };

    chrome_profile_directories()
        .into_iter()
        .any(|profile_directory| {
            profile_contains_target_extension_id(&profile_directory, extension_id)
        })
}

pub(crate) fn spawn_extension_shutdown_monitor(shutdown_tx: watch::Sender<bool>) {
    thread::spawn(move || {
        record_app_runtime_event("host", "extension-shutdown-monitor-started", None);
        let shutdown_rx = shutdown_tx.subscribe();
        let mut tracker = ExtensionInstallTracker::new();
        let mut last_logged_installed: Option<bool> = None;

        loop {
            if *shutdown_rx.borrow() {
                break;
            }

            let installed = tracker.refresh();

            if last_logged_installed != Some(installed) {
                record_app_runtime_event(
                    "host",
                    "extension-install-state",
                    Some(format!("installed={installed}")),
                );
                last_logged_installed = Some(installed);
            }

            if !installed {
                record_app_runtime_event("host", "extension-missing-shutdown", None);
                info!("target extension is no longer installed; shutting down tray host");
                let _ = shutdown_tx.send(true);
                break;
            }

            for _ in 0..(EXTENSION_INSTALL_CHECK_INTERVAL.as_secs().max(1) * 10) {
                if *shutdown_rx.borrow() {
                    return;
                }

                thread::sleep(Duration::from_millis(100));
            }
        }
    });
}

#[derive(Debug)]
struct ExtensionInstallTracker {
    detected_extension_ids: BTreeSet<String>,
    installed: bool,
}

impl ExtensionInstallTracker {
    fn new() -> Self {
        Self {
            detected_extension_ids: registered_extension_ids_from_allowed_origins()
                .into_iter()
                .collect(),
            installed: false,
        }
    }

    fn refresh(&mut self) -> bool {
        let scan = scan_for_registered_extension();

        if !scan.extension_ids.is_empty() {
            self.detected_extension_ids = scan.extension_ids.into_iter().collect();
            self.installed = !scan.enabled_extension_ids.is_empty();
            return self.installed;
        }

        if scan.scan_succeeded {
            self.installed = false;
            return false;
        }

        self.installed = self
            .detected_extension_ids
            .iter()
            .any(|extension_id| is_detected_extension_storage_present(extension_id));
        self.installed
    }
}
