use super::super::{current_executable, APP_REGISTRY_PATH, RUN_KEY_PATH, RUN_VALUE_NAME};
use anyhow::{Context, Result};
use chrono::Utc;
use std::path::{Path, PathBuf};
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

pub(super) struct AppRegistration {
    pub(super) app_path: Option<String>,
    pub(super) install_dir: Option<String>,
    pub(super) extension_id: Option<String>,
    pub(super) extension_ids: Vec<String>,
}

pub(super) fn write_app_registration() -> Result<()> {
    let app_path = current_executable()?;
    let install_dir = app_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("local app executable directory is not available"))?;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (app_key, _) = hkcu
        .create_subkey(APP_REGISTRY_PATH)
        .context("failed to create ZeroLatencyWeb registry key")?;

    app_key.set_value(APP_PATH_VALUE_NAME, &app_path.to_string_lossy().to_string())?;
    app_key.set_value(
        INSTALL_DIR_VALUE_NAME,
        &install_dir.to_string_lossy().to_string(),
    )?;
    app_key.set_value(INSTALLED_AT_VALUE_NAME, &Utc::now().to_rfc3339())?;
    app_key.set_value(VERSION_VALUE_NAME, &env!("CARGO_PKG_VERSION"))?;

    Ok(())
}

pub(super) fn write_native_messaging_app_registration(
    extension_ids: &[String],
    manifest_path: &Path,
) -> Result<()> {
    let primary_extension_id = extension_ids.first().cloned().unwrap_or_default();
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (app_key, _) = hkcu
        .create_subkey(APP_REGISTRY_PATH)
        .context("failed to open ZeroLatencyWeb registry key")?;

    app_key.set_value(EXTENSION_ID_VALUE_NAME, &primary_extension_id)?;
    app_key.set_value(EXTENSION_IDS_VALUE_NAME, &extension_ids.join("\n"))?;
    app_key.set_value(
        MANIFEST_PATH_VALUE_NAME,
        &manifest_path.to_string_lossy().to_string(),
    )?;

    Ok(())
}

pub(super) fn remove_app_registration() -> Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    match hkcu.delete_subkey_all(APP_REGISTRY_PATH) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).context("failed to remove ZeroLatencyWeb registry key"),
    }
}

pub(super) fn read_app_registration() -> Result<AppRegistration> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(app_key) = hkcu.open_subkey(APP_REGISTRY_PATH) else {
        return Ok(AppRegistration {
            app_path: None,
            install_dir: None,
            extension_id: None,
            extension_ids: Vec::new(),
        });
    };
    let extension_id = app_key.get_value(EXTENSION_ID_VALUE_NAME).ok();
    let extension_ids = app_key
        .get_value::<String, _>(EXTENSION_IDS_VALUE_NAME)
        .ok()
        .map(|value| {
            value
                .lines()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .filter(|values| !values.is_empty())
        .or_else(|| extension_id.clone().map(|value| vec![value]))
        .unwrap_or_default();

    Ok(AppRegistration {
        app_path: app_key.get_value(APP_PATH_VALUE_NAME).ok(),
        install_dir: app_key.get_value(INSTALL_DIR_VALUE_NAME).ok(),
        extension_id,
        extension_ids,
    })
}

pub(super) fn watcher_run_registered() -> Result<bool> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(run_key) = hkcu.open_subkey(RUN_KEY_PATH) else {
        return Ok(false);
    };

    let value: Result<String, _> = run_key.get_value(RUN_VALUE_NAME);
    Ok(value.is_ok())
}

pub(super) fn paths_equal(left: &str, right: &Path) -> bool {
    let left_path = PathBuf::from(left);
    match (left_path.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left_path == *right,
    }
}

const APP_PATH_VALUE_NAME: &str = "AppPath";
const INSTALL_DIR_VALUE_NAME: &str = "InstallDir";
const INSTALLED_AT_VALUE_NAME: &str = "InstalledAt";
const MANIFEST_PATH_VALUE_NAME: &str = "NativeMessagingManifestPath";
const EXTENSION_ID_VALUE_NAME: &str = "ExtensionId";
const EXTENSION_IDS_VALUE_NAME: &str = "ExtensionIds";
const VERSION_VALUE_NAME: &str = "Version";
