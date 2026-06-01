use super::super::{
    current_executable, ensure_portable_parent_dir, portable_path, NATIVE_MESSAGING_HOST_NAME,
};
use anyhow::{Context, Result};
use serde_json::json;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

pub(super) fn write_native_messaging_manifest(extension_ids: &[String]) -> Result<PathBuf> {
    let manifest_path = native_messaging_manifest_path()?;
    ensure_portable_parent_dir(&manifest_path)?;

    let manifest = build_native_messaging_manifest(extension_ids, &current_executable()?)?;

    fs::write(&manifest_path, serde_json::to_vec_pretty(&manifest)?)
        .with_context(|| format!("failed to write {}", manifest_path.display()))?;

    Ok(manifest_path)
}

fn build_native_messaging_manifest(
    extension_ids: &[String],
    executable_path: &Path,
) -> Result<serde_json::Value> {
    let allowed_origins = build_allowed_origins(extension_ids);

    if allowed_origins.is_empty() {
        return Err(anyhow::anyhow!(
            "cannot write native messaging manifest without an extension id"
        ));
    }

    Ok(json!({
        "name": NATIVE_MESSAGING_HOST_NAME,
        "description": "Zero-Latency Web portable local app launcher",
        "path": executable_path.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": allowed_origins
    }))
}

fn build_allowed_origins(extension_ids: &[String]) -> Vec<String> {
    extension_ids
        .iter()
        .filter(|extension_id| {
            extension_id.len() == 32
                && extension_id
                    .chars()
                    .all(|character| character.is_ascii_lowercase())
        })
        .map(|extension_id| format!("chrome-extension://{extension_id}/"))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_allowed_origins_deduplicates_and_sorts_extension_ids() {
        let origins = build_allowed_origins(&[
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_string(),
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string(),
            "invalid".to_string(),
        ]);

        assert_eq!(
            origins,
            vec![
                "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/".to_string(),
                "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/".to_string(),
            ]
        );
    }
}
