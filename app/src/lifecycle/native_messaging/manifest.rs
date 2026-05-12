use super::super::{
    current_executable, ensure_portable_parent_dir, portable_path, NATIVE_MESSAGING_HOST_NAME,
};
use anyhow::{Context, Result};
use serde_json::json;
use std::fs;
use std::path::PathBuf;

pub(super) fn write_native_messaging_manifest(extension_id: &str) -> Result<PathBuf> {
    let manifest_path = native_messaging_manifest_path()?;
    ensure_portable_parent_dir(&manifest_path)?;

    let manifest = json!({
        "name": NATIVE_MESSAGING_HOST_NAME,
        "description": "Zero-Latency Web portable local app launcher",
        "path": current_executable()?.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": [
            format!("chrome-extension://{extension_id}/")
        ]
    });

    fs::write(&manifest_path, serde_json::to_vec_pretty(&manifest)?)
        .with_context(|| format!("failed to write {}", manifest_path.display()))?;

    Ok(manifest_path)
}

pub(super) fn remove_native_messaging_manifest() -> Result<()> {
    let manifest_path = native_messaging_manifest_path()?;

    if manifest_path.exists() {
        fs::remove_file(&manifest_path)
            .with_context(|| format!("failed to remove {}", manifest_path.display()))?;
        crate::runtime_debug::record_app_runtime_event(
            "native-messaging",
            "manifest-removed",
            Some(manifest_path.display().to_string()),
        );
    }

    Ok(())
}

pub(super) fn native_messaging_manifest_path() -> Result<PathBuf> {
    portable_path(&format!(
        "native-messaging\\{NATIVE_MESSAGING_HOST_NAME}.json"
    ))
}
