use super::*;
use crate::runtime_debug::record_app_runtime_event;
use serde_json::Value;
use std::io::BufReader;

const TARGET_EXTENSION_NAME: &str = "Zero-Latency Web";
const TARGET_EXTENSION_DESCRIPTION: &str =
    "Zero-Latency Web extension MVP for visit graph tracking.";
const TARGET_EXTENSION_SERVICE_WORKER: &str = "service-worker.js";
const TARGET_EXTENSION_OPTIONS_PAGE: &str = "settings/index.html";

#[derive(Debug, Default)]
struct ExtensionInstallTracker {
    detected_extension_id: Option<String>,
    installed: bool,
}

pub(crate) fn acquire_host_guard() -> Result<Option<SingleInstance>> {
    acquire_single_instance(HOST_INSTANCE_NAME)
}

pub(crate) fn target_extension_is_installed() -> bool {
    let mut tracker = ExtensionInstallTracker::default();
    tracker.refresh()
}

pub(crate) fn spawn_extension_shutdown_monitor(shutdown_tx: watch::Sender<bool>) {
    thread::spawn(move || {
        record_app_runtime_event("host", "extension-shutdown-monitor-started", None);
        let shutdown_rx = shutdown_tx.subscribe();
        let mut extension_tracker = ExtensionInstallTracker::default();
        let mut last_logged_extension_installed: Option<bool> = None;

        loop {
            if *shutdown_rx.borrow() {
                break;
            }

            let extension_installed = extension_tracker.refresh();

            if last_logged_extension_installed != Some(extension_installed) {
                record_app_runtime_event(
                    "host",
                    "extension-monitor-installed-changed",
                    Some(extension_installed.to_string()),
                );
                info!("host extension-installed state changed: {extension_installed}");
                last_logged_extension_installed = Some(extension_installed);
            }

            if !extension_installed {
                record_app_runtime_event("host", "extension-monitor-triggered-shutdown", None);
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

fn acquire_single_instance(name: &str) -> Result<Option<SingleInstance>> {
    let guard = SingleInstance::new(name).context("failed to create single-instance guard")?;

    if guard.is_single() {
        Ok(Some(guard))
    } else {
        Ok(None)
    }
}

fn chrome_profile_directories() -> Vec<PathBuf> {
    let Some(user_data_root) = chrome_user_data_root() else {
        return Vec::new();
    };

    let mut directories = Vec::new();

    if user_data_root.join("Default").is_dir() {
        directories.push(user_data_root.join("Default"));
    }

    let Ok(entries) = fs::read_dir(&user_data_root) else {
        return directories;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|file_name| file_name.to_str()) else {
            continue;
        };

        if path.is_dir() && name.starts_with("Profile ") {
            directories.push(path);
        }
    }

    directories
}

struct ExtensionScanResult {
    extension_id: Option<String>,
    scan_succeeded: bool,
}

impl ExtensionInstallTracker {
    fn refresh(&mut self) -> bool {
        let extension_scan = scan_for_registered_extension();

        if let Some(extension_id) = extension_scan.extension_id {
            self.detected_extension_id = Some(extension_id);
            self.installed = true;
        } else if extension_scan.scan_succeeded {
            self.detected_extension_id = None;
            self.installed = false;
        } else {
            self.installed = self
                .detected_extension_id
                .as_deref()
                .is_some_and(is_detected_extension_storage_present);
        }

        self.installed
    }
}

fn scan_for_registered_extension() -> ExtensionScanResult {
    let mut scan_succeeded = false;

    for profile_directory in chrome_profile_directories() {
        match secure_preferences_target_extension_id(&profile_directory) {
            SecurePreferencesScan::Found(extension_id) => {
                return ExtensionScanResult {
                    extension_id: Some(extension_id),
                    scan_succeeded: true,
                };
            }
            SecurePreferencesScan::ScannedNoMatch => {
                scan_succeeded = true;
            }
            SecurePreferencesScan::Unreadable => {}
        }
    }

    ExtensionScanResult {
        extension_id: None,
        scan_succeeded,
    }
}

enum SecurePreferencesScan {
    Found(String),
    ScannedNoMatch,
    Unreadable,
}

fn secure_preferences_target_extension_id(profile_directory: &PathBuf) -> SecurePreferencesScan {
    let secure_preferences_path = profile_directory.join("Secure Preferences");
    let Ok(file) = fs::File::open(secure_preferences_path) else {
        return SecurePreferencesScan::Unreadable;
    };
    let reader = BufReader::new(file);
    let Ok(value) = serde_json::from_reader::<_, Value>(reader) else {
        return SecurePreferencesScan::Unreadable;
    };

    let Some(settings) = value
        .get("extensions")
        .and_then(|extensions| extensions.get("settings"))
        .and_then(Value::as_object)
    else {
        return SecurePreferencesScan::ScannedNoMatch;
    };

    for (extension_id, entry) in settings {
        if is_target_extension_entry(entry) {
            return SecurePreferencesScan::Found(extension_id.to_string());
        }
    }

    SecurePreferencesScan::ScannedNoMatch
}

fn is_detected_extension_storage_present(extension_id: &str) -> bool {
    chrome_profile_directories()
        .into_iter()
        .any(|profile_directory| {
            profile_directory
                .join("Local Extension Settings")
                .join(extension_id)
                .is_dir()
        })
}

fn is_target_extension_entry(entry: &Value) -> bool {
    if entry
        .get("manifest")
        .is_some_and(is_target_extension_manifest)
    {
        return true;
    }

    entry
        .get("path")
        .and_then(Value::as_str)
        .is_some_and(|extension_path| extension_manifest_at_path_matches(extension_path))
}

fn extension_manifest_at_path_matches(extension_path: &str) -> bool {
    let manifest_path = PathBuf::from(extension_path).join("manifest.json");
    let Ok(file) = fs::File::open(manifest_path) else {
        return false;
    };
    let reader = BufReader::new(file);
    let Ok(value) = serde_json::from_reader::<_, Value>(reader) else {
        return false;
    };

    is_target_extension_manifest(&value)
}

fn is_target_extension_manifest(manifest: &Value) -> bool {
    let name_matches = manifest
        .get("name")
        .and_then(Value::as_str)
        .is_some_and(|name| name == TARGET_EXTENSION_NAME);
    let description_matches = manifest
        .get("description")
        .and_then(Value::as_str)
        .is_some_and(|description| description == TARGET_EXTENSION_DESCRIPTION);
    let service_worker_matches = manifest
        .get("background")
        .and_then(|background| background.get("service_worker"))
        .and_then(Value::as_str)
        .is_some_and(|service_worker| service_worker == TARGET_EXTENSION_SERVICE_WORKER);
    let options_page_matches = manifest
        .get("options_page")
        .and_then(Value::as_str)
        .is_some_and(|options_page| options_page == TARGET_EXTENSION_OPTIONS_PAGE);

    name_matches && description_matches && service_worker_matches && options_page_matches
}
