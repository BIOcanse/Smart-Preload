mod manifest;
mod process;
mod protocol;
mod registry;

use crate::runtime_debug::record_app_runtime_event;
use serde_json::json;
use std::collections::BTreeMap;
use std::path::PathBuf;

use super::{disable_watcher_registration, NATIVE_MESSAGING_HOST_NAME};
use anyhow::Result;

pub(crate) fn ensure_native_messaging_registration(extension_ids: &[String]) -> Result<PathBuf> {
    disable_watcher_registration()?;

    let manifest_path = manifest::write_native_messaging_manifest(extension_ids)?;
    registry::ensure_native_messaging_registry_entries(&manifest_path)?;

    record_app_runtime_event(
        "native-messaging",
        "registration-ensured",
        Some(format!(
            "{}::{}",
            extension_ids.join(","),
            manifest_path.display()
        )),
    );

    Ok(manifest_path)
}

pub(crate) fn run_native_messaging_host() -> Result<()> {
    record_app_runtime_event("native-messaging", "wake-received", None);

    let response = match process::spawn_host_process() {
        Ok(()) => {
            record_app_runtime_event("native-messaging", "host-spawn-requested", None);
            json!({
                "ok": true,
                "host": NATIVE_MESSAGING_HOST_NAME,
                "action": "wake-host"
            })
        }
        Err(error) => {
            record_app_runtime_event(
                "native-messaging",
                "host-spawn-failed",
                Some(error.to_string()),
            );
            json!({
                "ok": false,
                "host": NATIVE_MESSAGING_HOST_NAME,
                "error": error.to_string()
            })
        }
    };

    protocol::write_native_message(&response)?;
    Ok(())
}

pub(crate) fn remove_native_messaging_registration() -> Result<()> {
    registry::remove_native_messaging_registry_entries()?;
    manifest::remove_native_messaging_manifest()?;
    Ok(())
}

pub(crate) fn native_messaging_registration_status(
) -> Result<(BTreeMap<String, String>, PathBuf, bool)> {
    let registry_values = registry::read_native_messaging_registry_values()?;
    let manifest_path = manifest::native_messaging_manifest_path()?;
    let manifest_exists = manifest_path.exists();
    Ok((registry_values, manifest_path, manifest_exists))
}

pub(crate) fn native_messaging_registry_browser_count() -> usize {
    registry::native_messaging_registry_browser_count()
}
