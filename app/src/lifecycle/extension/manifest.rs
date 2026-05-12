use serde_json::Value;
use std::fs;
use std::io::BufReader;
use std::path::PathBuf;

const TARGET_EXTENSION_NAME: &str = "Zero-Latency Web";
const TARGET_EXTENSION_NAME_I18N: &str = "__MSG_appName__";
const TARGET_EXTENSION_DESCRIPTION: &str =
    "Zero-Latency Web extension MVP for visit graph tracking.";
const TARGET_EXTENSION_DESCRIPTION_CURRENT: &str =
    "Zero-Latency Web extension for visit graph tracking and predictive preloading.";
const TARGET_EXTENSION_DESCRIPTION_I18N: &str = "__MSG_appDescription__";
const TARGET_EXTENSION_SERVICE_WORKER: &str = "service-worker.js";
const TARGET_EXTENSION_OPTIONS_PAGE: &str = "settings/index.html";

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
