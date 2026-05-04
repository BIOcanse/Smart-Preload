use super::*;
use crate::runtime_debug::record_app_runtime_event;
use serde_json::Value;
use std::io::BufReader;

const TARGET_EXTENSION_NAME: &str = "Zero-Latency Web";
const TARGET_EXTENSION_NAME_I18N: &str = "__MSG_appName__";
const TARGET_EXTENSION_DESCRIPTION: &str =
    "Zero-Latency Web extension MVP for visit graph tracking.";
const TARGET_EXTENSION_DESCRIPTION_CURRENT: &str =
    "Zero-Latency Web extension for visit graph tracking and predictive preloading.";
const TARGET_EXTENSION_DESCRIPTION_I18N: &str = "__MSG_appDescription__";
const TARGET_EXTENSION_SERVICE_WORKER: &str = "service-worker.js";
const TARGET_EXTENSION_OPTIONS_PAGE: &str = "settings/index.html";

pub(crate) fn target_extension_id() -> Option<String> {
    scan_for_registered_extension().extension_id
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
        .any(
            |profile_directory| match secure_preferences_target_extension_id(&profile_directory) {
                SecurePreferencesScan::Found(found_extension_id) => {
                    found_extension_id == extension_id
                }
                SecurePreferencesScan::ScannedNoMatch | SecurePreferencesScan::Unreadable => false,
            },
        )
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

#[derive(Debug, Default)]
struct ExtensionScanResult {
    extension_id: Option<String>,
    scan_succeeded: bool,
}

#[derive(Debug)]
struct ExtensionInstallTracker {
    detected_extension_id: Option<String>,
    installed: bool,
}

impl ExtensionInstallTracker {
    fn new() -> Self {
        Self {
            detected_extension_id: registered_extension_id_from_allowed_origin(),
            installed: false,
        }
    }

    fn refresh(&mut self) -> bool {
        let scan = scan_for_registered_extension();

        if let Some(extension_id) = scan.extension_id {
            self.detected_extension_id = Some(extension_id);
            self.installed = true;
            return true;
        }

        if scan.scan_succeeded {
            self.installed = false;
            return false;
        }

        self.installed = self
            .detected_extension_id
            .as_deref()
            .is_some_and(is_detected_extension_storage_present);
        self.installed
    }
}

fn chrome_profile_directories() -> Vec<PathBuf> {
    let Some(user_data_root) = chrome_user_data_root() else {
        return Vec::new();
    };

    let mut directories = Vec::new();

    push_chrome_profile_directory_if_present(&mut directories, user_data_root.join("Default"));
    push_chrome_profile_directory_if_present(&mut directories, user_data_root.join("Profile"));

    let Ok(entries) = fs::read_dir(&user_data_root) else {
        return directories;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|file_name| file_name.to_str()) else {
            continue;
        };

        if !path.is_dir() {
            continue;
        }

        if name.starts_with("Profile ")
            || path.join("Preferences").is_file()
            || path.join("Secure Preferences").is_file()
        {
            push_chrome_profile_directory_if_present(&mut directories, path);
        }
    }

    directories
}

fn push_chrome_profile_directory_if_present(directories: &mut Vec<PathBuf>, path: PathBuf) {
    if !path.is_dir() || directories.iter().any(|directory| directory == &path) {
        return;
    }

    directories.push(path);
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
        .is_some_and(is_target_extension_name);
    let description_matches = manifest
        .get("description")
        .and_then(Value::as_str)
        .is_some_and(is_target_extension_description);
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

fn is_target_extension_name(name: &str) -> bool {
    matches!(name, TARGET_EXTENSION_NAME | TARGET_EXTENSION_NAME_I18N)
}

fn is_target_extension_description(description: &str) -> bool {
    matches!(
        description,
        TARGET_EXTENSION_DESCRIPTION
            | TARGET_EXTENSION_DESCRIPTION_CURRENT
            | TARGET_EXTENSION_DESCRIPTION_I18N
    )
}

fn registered_extension_id_from_allowed_origin() -> Option<String> {
    let origin_path = portable_path("allowed-extension-origin.txt").ok()?;
    let origin = fs::read_to_string(origin_path).ok()?;
    let trimmed_origin = origin.trim();
    let extension_id = trimmed_origin.strip_prefix("chrome-extension://")?;

    is_valid_extension_id(extension_id).then(|| extension_id.to_owned())
}

fn is_valid_extension_id(extension_id: &str) -> bool {
    extension_id.len() == 32
        && extension_id
            .chars()
            .all(|character| character.is_ascii_lowercase())
}

fn is_detected_extension_storage_present(extension_id: &str) -> bool {
    if !is_valid_extension_id(extension_id) {
        return false;
    }

    chrome_profile_directories()
        .into_iter()
        .any(|profile_directory| {
            profile_directory
                .join("Local Extension Settings")
                .join(extension_id)
                .is_dir()
                || profile_directory
                    .join("IndexedDB")
                    .read_dir()
                    .ok()
                    .into_iter()
                    .flatten()
                    .flatten()
                    .any(|entry| {
                        entry
                            .file_name()
                            .to_str()
                            .is_some_and(|name| name.contains(extension_id))
                    })
        })
}
