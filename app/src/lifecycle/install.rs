use super::*;
use crate::runtime_debug::record_app_runtime_event;
use chrono::Utc;
use serde::Serialize;

const APP_PATH_VALUE_NAME: &str = "AppPath";
const INSTALL_DIR_VALUE_NAME: &str = "InstallDir";
const INSTALLED_AT_VALUE_NAME: &str = "InstalledAt";
const MANIFEST_PATH_VALUE_NAME: &str = "NativeMessagingManifestPath";
const EXTENSION_ID_VALUE_NAME: &str = "ExtensionId";
const VERSION_VALUE_NAME: &str = "Version";

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

pub(crate) fn install_portable_app() -> Result<PortableInstallStatus> {
    disable_watcher_registration()?;
    write_app_registration()?;

    let extension_id = target_extension_id().or_else(|| {
        read_app_registration()
            .ok()
            .and_then(|registration| registration.extension_id)
    });
    if let Some(extension_id) = extension_id.as_deref() {
        persist_allowed_extension_origin(extension_id)?;
        let manifest_path = native_messaging::ensure_native_messaging_registration(extension_id)?;
        write_native_messaging_app_registration(extension_id, &manifest_path)?;
        record_app_runtime_event(
            "installer",
            "native-messaging-registered",
            Some(format!("{extension_id}::{}", manifest_path.display())),
        );
    } else {
        native_messaging::remove_native_messaging_registration()?;
        record_app_runtime_event(
            "installer",
            "native-messaging-skipped-extension-missing",
            None,
        );
    }

    let status = portable_install_status()?;
    write_portable_install_status_snapshot(&status)?;
    record_app_runtime_event("installer", "install-completed", None);
    Ok(status)
}

pub(crate) fn uninstall_portable_app() -> Result<PortableInstallStatus> {
    disable_watcher_registration()?;
    native_messaging::remove_native_messaging_registration()?;
    remove_app_registration()?;

    let status = portable_install_status()?;
    write_portable_install_status_snapshot(&status)?;
    record_app_runtime_event("installer", "uninstall-completed", None);
    Ok(status)
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

fn write_app_registration() -> Result<()> {
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

fn write_native_messaging_app_registration(
    extension_id: &str,
    manifest_path: &PathBuf,
) -> Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (app_key, _) = hkcu
        .create_subkey(APP_REGISTRY_PATH)
        .context("failed to open ZeroLatencyWeb registry key")?;

    app_key.set_value(EXTENSION_ID_VALUE_NAME, &extension_id.to_string())?;
    app_key.set_value(
        MANIFEST_PATH_VALUE_NAME,
        &manifest_path.to_string_lossy().to_string(),
    )?;

    Ok(())
}

fn remove_app_registration() -> Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    match hkcu.delete_subkey_all(APP_REGISTRY_PATH) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).context("failed to remove ZeroLatencyWeb registry key"),
    }
}

struct AppRegistration {
    app_path: Option<String>,
    install_dir: Option<String>,
    extension_id: Option<String>,
}

fn read_app_registration() -> Result<AppRegistration> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(app_key) = hkcu.open_subkey(APP_REGISTRY_PATH) else {
        return Ok(AppRegistration {
            app_path: None,
            install_dir: None,
            extension_id: None,
        });
    };

    Ok(AppRegistration {
        app_path: app_key.get_value(APP_PATH_VALUE_NAME).ok(),
        install_dir: app_key.get_value(INSTALL_DIR_VALUE_NAME).ok(),
        extension_id: app_key.get_value(EXTENSION_ID_VALUE_NAME).ok(),
    })
}

fn persist_allowed_extension_origin(extension_id: &str) -> Result<()> {
    let origin_path = portable_path("allowed-extension-origin.txt")?;
    let origins_path = portable_path("allowed-extension-origins.txt")?;
    let origin = format!("chrome-extension://{extension_id}");
    ensure_portable_parent_dir(&origin_path)?;
    ensure_portable_parent_dir(&origins_path)?;
    fs::write(origin_path, &origin)?;
    fs::write(origins_path, origin)?;
    Ok(())
}

fn watcher_run_registered() -> Result<bool> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(run_key) = hkcu.open_subkey(RUN_KEY_PATH) else {
        return Ok(false);
    };

    let value: Result<String, _> = run_key.get_value(RUN_VALUE_NAME);
    Ok(value.is_ok())
}

fn paths_equal(left: &str, right: &PathBuf) -> bool {
    let left_path = PathBuf::from(left);
    match (left_path.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left_path == *right,
    }
}
