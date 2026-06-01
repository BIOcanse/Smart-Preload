use std::collections::BTreeSet;
use std::fs;

use super::super::portable_path;
use super::profile::chrome_profile_directories;

pub(super) fn registered_extension_ids_from_allowed_origins() -> Vec<String> {
    let mut extension_ids = BTreeSet::new();

    for path in [
        portable_path("allowed-extension-origins.txt").ok(),
        portable_path("allowed-extension-origin.txt").ok(),
    ]
    .into_iter()
    .flatten()
    {
        let Ok(raw_value) = fs::read_to_string(path) else {
            continue;
        };

        for line in raw_value.lines() {
            if let Some(extension_id) = extension_id_from_origin(line) {
                extension_ids.insert(extension_id);
            }
        }
    }

    extension_ids.into_iter().collect()
}

pub(super) fn is_valid_extension_id(extension_id: &str) -> bool {
    extension_id.len() == 32
        && extension_id
            .chars()
            .all(|character| character.is_ascii_lowercase())
}

pub(super) fn is_detected_extension_storage_present(extension_id: &str) -> bool {
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

fn extension_id_from_origin(origin: &str) -> Option<String> {
    let trimmed_origin = origin.trim();
    let extension_id = trimmed_origin.strip_prefix("chrome-extension://")?;

    is_valid_extension_id(extension_id).then(|| extension_id.to_owned())
}
