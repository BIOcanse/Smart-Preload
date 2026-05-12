use serde_json::Value;
use std::fs;
use std::io::BufReader;
use std::path::Path;

use super::manifest::is_target_extension_entry;
use super::profile::chrome_profile_directories;

#[derive(Debug, Default)]
pub(super) struct ExtensionScanResult {
    pub(super) extension_id: Option<String>,
    pub(super) scan_succeeded: bool,
}

pub(super) fn scan_for_registered_extension() -> ExtensionScanResult {
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

pub(super) fn profile_contains_target_extension_id(
    profile_directory: &Path,
    extension_id: &str,
) -> bool {
    matches!(
        secure_preferences_target_extension_id(profile_directory),
        SecurePreferencesScan::Found(found_extension_id) if found_extension_id == extension_id
    )
}

enum SecurePreferencesScan {
    Found(String),
    ScannedNoMatch,
    Unreadable,
}

fn secure_preferences_target_extension_id(profile_directory: &Path) -> SecurePreferencesScan {
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
