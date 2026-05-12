use std::fs;

use super::super::portable_path;
use super::profile::chrome_profile_directories;

pub(super) fn registered_extension_id_from_allowed_origin() -> Option<String> {
    let origin_path = portable_path("allowed-extension-origin.txt").ok()?;
    let origin = fs::read_to_string(origin_path).ok()?;
    let trimmed_origin = origin.trim();
    let extension_id = trimmed_origin.strip_prefix("chrome-extension://")?;

    is_valid_extension_id(extension_id).then(|| extension_id.to_owned())
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
