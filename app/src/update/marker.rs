use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use anyhow::Context;
use serde_json::{json, Value};

use super::model::ValidatedUpdate;
use super::paths::{current_install_dir, updater_root};

const STALE_MARKER_AGE: Duration = Duration::from_secs(6 * 60 * 60);
const UPDATE_MARKER_FILE: &str = "update-in-progress.json";

#[derive(Debug)]
pub(super) enum AcquireMarkerError {
    AlreadyExists,
    Other(anyhow::Error),
}

pub(super) fn update_marker_path(updater_root: &Path) -> PathBuf {
    updater_root.join(UPDATE_MARKER_FILE)
}

pub(super) fn acquire_update_marker(
    marker_path: &Path,
    update: &ValidatedUpdate,
) -> Result<(), AcquireMarkerError> {
    if marker_path.exists() && marker_is_stale(marker_path) {
        fs::remove_file(marker_path)
            .context("failed to remove stale app update marker")
            .map_err(AcquireMarkerError::Other)?;
    }

    let marker = json!({
        "schemaVersion": 1,
        "phase": "acquiring",
        "targetVersion": update.target_version,
        "ownerPid": std::process::id(),
        "updatedAtUtc": chrono::Utc::now().to_rfc3339(),
    });
    let serialized = serde_json::to_vec(&marker).map_err(|error| {
        AcquireMarkerError::Other(
            anyhow::Error::new(error).context("failed to serialize update marker"),
        )
    })?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(marker_path)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                AcquireMarkerError::AlreadyExists
            } else {
                AcquireMarkerError::Other(
                    anyhow::Error::new(error).context("failed to acquire app update marker"),
                )
            }
        })?;
    file.write_all(&serialized)
        .and_then(|_| file.sync_all())
        .map_err(|error| {
            let _ = fs::remove_file(marker_path);
            AcquireMarkerError::Other(
                anyhow::Error::new(error).context("failed to persist app update marker"),
            )
        })?;
    Ok(())
}

pub(crate) fn updater_status() -> String {
    let Ok(install_dir) = current_install_dir() else {
        return "unavailable".to_string();
    };
    let Ok(root) = updater_root(&install_dir) else {
        return "unavailable".to_string();
    };
    let marker_path = update_marker_path(&root);

    let Ok(contents) = fs::read_to_string(marker_path) else {
        return "ready".to_string();
    };
    let phase = serde_json::from_str::<Value>(&contents)
        .ok()
        .and_then(|value| value.get("phase")?.as_str().map(str::to_string));

    phase.unwrap_or_else(|| "updating".to_string())
}

pub(crate) fn update_in_progress() -> bool {
    let Ok(install_dir) = current_install_dir() else {
        return false;
    };
    let Ok(root) = updater_root(&install_dir) else {
        return false;
    };
    let marker_path = update_marker_path(&root);
    update_marker_is_active(&marker_path)
}

fn update_marker_is_active(marker_path: &Path) -> bool {
    marker_path.is_file() && !marker_is_stale(marker_path)
}

fn marker_is_stale(marker_path: &Path) -> bool {
    fs::metadata(marker_path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .is_some_and(|age| age >= STALE_MARKER_AGE)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn update_marker_is_an_atomic_single_job_mutex() {
        let root = temporary_test_directory("marker-mutex");
        let marker = root.join(UPDATE_MARKER_FILE);
        let update = test_update("1.2.3");

        acquire_update_marker(&marker, &update).expect("first marker acquisition");
        assert!(matches!(
            acquire_update_marker(&marker, &update),
            Err(AcquireMarkerError::AlreadyExists)
        ));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_fresh_marker_suppresses_native_wake() {
        let root = temporary_test_directory("wake-suppression");
        let marker = root.join(UPDATE_MARKER_FILE);
        fs::write(&marker, b"{}").expect("write marker");

        assert!(update_marker_is_active(&marker));
        let _ = fs::remove_dir_all(root);
    }

    fn temporary_test_directory(label: &str) -> PathBuf {
        let sequence = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "smart-preload-marker-{label}-{}-{sequence}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("create test directory");
        path
    }

    fn test_update(version: &str) -> ValidatedUpdate {
        ValidatedUpdate {
            target_version: version.to_string(),
            release_tag: format!("v{version}"),
            asset_name: format!("zero-latency-web-app-windows-x64-v{version}.zip"),
            asset_url: format!(
                "https://github.com/BIOcanse/Smart-Preload/releases/download/v{version}/zero-latency-web-app-windows-x64-v{version}.zip"
            ),
            manifest_name: format!(
                "zero-latency-web-app-windows-x64-v{version}.zip.sha256.txt"
            ),
            manifest_url: format!(
                "https://github.com/BIOcanse/Smart-Preload/releases/download/v{version}/zero-latency-web-app-windows-x64-v{version}.zip.sha256.txt"
            ),
            signature_name: format!(
                "zero-latency-web-app-windows-x64-v{version}.zip.sha256.txt.sig"
            ),
            signature_url: format!(
                "https://github.com/BIOcanse/Smart-Preload/releases/download/v{version}/zero-latency-web-app-windows-x64-v{version}.zip.sha256.txt.sig"
            ),
        }
    }
}
