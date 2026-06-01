use serde_json::Value;
use std::collections::BTreeSet;
use std::fs;
use std::io::BufReader;
use std::path::Path;

use super::manifest::is_target_extension_entry;
use super::profile::chrome_profile_directories;

#[derive(Debug, Default)]
pub(super) struct ExtensionScanResult {
    pub(super) extension_id: Option<String>,
    pub(super) extension_ids: Vec<String>,
    pub(super) enabled_extension_ids: Vec<String>,
    pub(super) disabled_extension_ids: Vec<String>,
    pub(super) scan_succeeded: bool,
}

pub(super) fn scan_for_registered_extension() -> ExtensionScanResult {
    let mut scan_succeeded = false;
    let mut extension_ids = BTreeSet::new();
    let mut enabled_extension_ids = BTreeSet::new();
    let mut disabled_extension_ids = BTreeSet::new();

    for profile_directory in chrome_profile_directories() {
        match secure_preferences_target_extension_ids(&profile_directory) {
            SecurePreferencesScan::Found(found_entries) => {
                scan_succeeded = true;

                for entry in found_entries {
                    extension_ids.insert(entry.extension_id.clone());

                    if entry.enabled {
                        enabled_extension_ids.insert(entry.extension_id);
                    } else {
                        disabled_extension_ids.insert(entry.extension_id);
                    }
                }
            }
            SecurePreferencesScan::ScannedNoMatch => {
                scan_succeeded = true;
            }
            SecurePreferencesScan::Unreadable => {}
        }
    }

    disabled_extension_ids.retain(|extension_id| !enabled_extension_ids.contains(extension_id));

    let extension_ids = extension_ids.into_iter().collect::<Vec<_>>();
    let enabled_extension_ids = enabled_extension_ids.into_iter().collect::<Vec<_>>();
    let disabled_extension_ids = disabled_extension_ids.into_iter().collect::<Vec<_>>();

    ExtensionScanResult {
        extension_id: extension_ids.first().cloned(),
        extension_ids,
        enabled_extension_ids,
        disabled_extension_ids,
        scan_succeeded,
    }
}

pub(super) fn profile_contains_target_extension_id(
    profile_directory: &Path,
    extension_id: &str,
) -> bool {
    matches!(
        secure_preferences_target_extension_ids(profile_directory),
        SecurePreferencesScan::Found(found_extension_ids)
            if found_extension_ids
                .iter()
                .any(|found_extension| found_extension.extension_id == extension_id)
    )
}

enum SecurePreferencesScan {
    Found(Vec<TargetExtensionEntry>),
    ScannedNoMatch,
    Unreadable,
}

struct TargetExtensionEntry {
    extension_id: String,
    enabled: bool,
}

fn secure_preferences_target_extension_ids(profile_directory: &Path) -> SecurePreferencesScan {
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

    let mut extension_entries = Vec::new();

    for (extension_id, entry) in settings {
        if is_target_extension_entry(entry) {
            extension_entries.push(TargetExtensionEntry {
                extension_id: extension_id.to_string(),
                enabled: is_extension_entry_enabled(entry),
            });
        }
    }

    if extension_entries.is_empty() {
        SecurePreferencesScan::ScannedNoMatch
    } else {
        extension_entries.sort_by(|left, right| left.extension_id.cmp(&right.extension_id));
        extension_entries.dedup_by(|left, right| left.extension_id == right.extension_id);
        SecurePreferencesScan::Found(extension_entries)
    }
}

fn is_extension_entry_enabled(entry: &Value) -> bool {
    let has_disable_reasons = entry
        .get("disable_reasons")
        .and_then(Value::as_array)
        .is_some_and(|disable_reasons| !disable_reasons.is_empty());
    let state_disabled = entry
        .get("state")
        .and_then(Value::as_i64)
        .is_some_and(|state| state == 0);

    !has_disable_reasons && !state_disabled
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extension_entry_without_disable_reasons_is_enabled() {
        assert!(is_extension_entry_enabled(&json!({
            "manifest": {}
        })));
    }

    #[test]
    fn extension_entry_with_disable_reasons_is_disabled() {
        assert!(!is_extension_entry_enabled(&json!({
            "disable_reasons": [1]
        })));
    }

    #[test]
    fn extension_entry_with_disabled_state_is_disabled() {
        assert!(!is_extension_entry_enabled(&json!({
            "state": 0
        })));
    }
}
