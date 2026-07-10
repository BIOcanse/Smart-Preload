use serde_json::Value;
use std::fs;
use std::io::BufReader;
use std::path::PathBuf;

const TARGET_EXTENSION_NAME: &str = "Zero-Latency Web";
const TARGET_EXTENSION_NAME_CURRENT: &str = "Smart Preload";
const TARGET_EXTENSION_NAME_CURRENT_ZH_CN: &str = "智能预加载";
const TARGET_EXTENSION_NAME_I18N: &str = "__MSG_appName__";
const TARGET_EXTENSION_DESCRIPTION: &str =
    "Zero-Latency Web extension MVP for visit graph tracking.";
const TARGET_EXTENSION_DESCRIPTION_CURRENT: &str =
    "Zero-Latency Web extension for visit graph tracking and predictive preloading.";
const TARGET_EXTENSION_DESCRIPTION_I18N: &str = "__MSG_appDescription__";
const TARGET_EXTENSION_SERVICE_WORKER: &str = "service-worker.js";
const TARGET_EXTENSION_OPTIONS_PAGE: &str = "settings/index.html";
const TARGET_EXTENSION_LOCAL_API_PERMISSION: &str = "http://127.0.0.1:45831/*";

pub(super) fn is_target_extension_entry(entry: &Value) -> bool {
    if entry
        .get("manifest")
        .is_some_and(is_target_extension_manifest)
    {
        return true;
    }

    entry
        .get("path")
        .and_then(Value::as_str)
        .is_some_and(extension_manifest_at_path_matches)
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
    let manifest_version_matches = manifest
        .get("manifest_version")
        .and_then(Value::as_i64)
        .is_some_and(|manifest_version| manifest_version == 3);
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
    let permission_fingerprint_matches =
        manifest_array_contains(manifest, "permissions", "nativeMessaging")
            && manifest_array_contains(
                manifest,
                "host_permissions",
                TARGET_EXTENSION_LOCAL_API_PERMISSION,
            );

    manifest_version_matches
        && service_worker_matches
        && options_page_matches
        && (permission_fingerprint_matches || (name_matches && description_matches))
}

fn is_target_extension_name(name: &str) -> bool {
    matches!(
        name,
        TARGET_EXTENSION_NAME
            | TARGET_EXTENSION_NAME_CURRENT
            | TARGET_EXTENSION_NAME_CURRENT_ZH_CN
            | TARGET_EXTENSION_NAME_I18N
    )
}

fn is_target_extension_description(description: &str) -> bool {
    matches!(
        description,
        TARGET_EXTENSION_DESCRIPTION
            | TARGET_EXTENSION_DESCRIPTION_CURRENT
            | TARGET_EXTENSION_DESCRIPTION_I18N
    )
}

fn manifest_array_contains(manifest: &Value, key: &str, expected: &str) -> bool {
    manifest
        .get(key)
        .and_then(Value::as_array)
        .is_some_and(|values| {
            values
                .iter()
                .any(|value| value.as_str().is_some_and(|item| item == expected))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn target_manifest_matches_current_i18n_manifest_by_structure() {
        assert!(is_target_extension_manifest(&json!({
            "manifest_version": 3,
            "name": "__MSG_appName__",
            "description": "__MSG_appDescription__",
            "permissions": ["alarms", "nativeMessaging", "tabs", "windows"],
            "host_permissions": ["http://127.0.0.1:45831/*"],
            "background": {
                "service_worker": "service-worker.js"
            },
            "options_page": "settings/index.html"
        })));
    }

    #[test]
    fn target_manifest_matches_localized_display_name_when_profile_resolves_it() {
        assert!(is_target_extension_manifest(&json!({
            "manifest_version": 3,
            "name": "智能预加载",
            "description": "更智能、更积极地预加载你接下来可能打开的页面。",
            "permissions": ["nativeMessaging"],
            "host_permissions": ["http://127.0.0.1:45831/*"],
            "background": {
                "service_worker": "service-worker.js"
            },
            "options_page": "settings/index.html"
        })));
    }

    #[test]
    fn target_manifest_rejects_same_files_without_native_messaging_fingerprint() {
        assert!(!is_target_extension_manifest(&json!({
            "manifest_version": 3,
            "name": "Unrelated",
            "description": "Unrelated extension",
            "permissions": ["tabs"],
            "host_permissions": ["https://example.test/*"],
            "background": {
                "service_worker": "service-worker.js"
            },
            "options_page": "settings/index.html"
        })));
    }
}
