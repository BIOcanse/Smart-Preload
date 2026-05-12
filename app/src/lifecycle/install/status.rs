use super::super::{
    current_executable, ensure_portable_parent_dir, native_messaging, portable_path,
    target_extension_id,
};
use super::registry::{paths_equal, read_app_registration, watcher_run_registered};
use anyhow::Result;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PortableInstallStatus {
    pub installed: bool,
    pub app_path: String,
    pub registered_app_path: Option<String>,
    pub app_path_matches_current: bool,
    pub install_dir: String,
    pub registered_install_dir: Option<String>,
    pub extension_id: Option<String>,
    pub registered_extension_id: Option<String>,
    pub native_messaging_registered: bool,
    pub native_messaging_registry_value: Option<String>,
    pub native_messaging_manifest_path: String,
    pub native_messaging_manifest_exists: bool,
    pub watcher_run_registered: bool,
}

pub(crate) fn portable_install_status() -> Result<PortableInstallStatus> {
    let app_path = current_executable()?;
    let install_dir = app_path
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| anyhow::anyhow!("local app executable directory is not available"))?;
    let app_registration = read_app_registration()?;
    let (native_registry_value, manifest_path, manifest_exists) =
        native_messaging::native_messaging_registration_status()?;

    let registered_app_path = app_registration.app_path;
    let app_path_matches_current = registered_app_path
        .as_deref()
        .map(|registered| paths_equal(registered, &app_path))
        .unwrap_or(false);
    let native_messaging_registered = native_registry_value
        .as_deref()
        .map(|registered| paths_equal(registered, &manifest_path))
        .unwrap_or(false)
        && manifest_exists;

    Ok(PortableInstallStatus {
        installed: app_path_matches_current,
        app_path: app_path.to_string_lossy().to_string(),
        registered_app_path,
        app_path_matches_current,
        install_dir: install_dir.to_string_lossy().to_string(),
        registered_install_dir: app_registration.install_dir,
        extension_id: target_extension_id(),
        registered_extension_id: app_registration.extension_id,
        native_messaging_registered,
        native_messaging_registry_value: native_registry_value,
        native_messaging_manifest_path: manifest_path.to_string_lossy().to_string(),
        native_messaging_manifest_exists: manifest_exists,
        watcher_run_registered: watcher_run_registered()?,
    })
}

pub(crate) fn write_portable_install_status_snapshot(status: &PortableInstallStatus) -> Result<()> {
    let status_path = portable_path("install-status.json")?;
    ensure_portable_parent_dir(&status_path)?;
    fs::write(status_path, serde_json::to_vec_pretty(status)?)?;
    Ok(())
}
