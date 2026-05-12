mod origin;
mod registry;
mod status;

use crate::runtime_debug::record_app_runtime_event;

use super::{disable_watcher_registration, native_messaging, target_extension_id};
use anyhow::Result;
pub(crate) use status::{
    portable_install_status, write_portable_install_status_snapshot, PortableInstallStatus,
};

pub(crate) fn install_portable_app() -> Result<PortableInstallStatus> {
    disable_watcher_registration()?;
    registry::write_app_registration()?;

    let extension_id = target_extension_id().or_else(|| {
        registry::read_app_registration()
            .ok()
            .and_then(|registration| registration.extension_id)
    });
    if let Some(extension_id) = extension_id.as_deref() {
        origin::persist_allowed_extension_origin(extension_id)?;
        let manifest_path = native_messaging::ensure_native_messaging_registration(extension_id)?;
        registry::write_native_messaging_app_registration(extension_id, &manifest_path)?;
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
    registry::remove_app_registration()?;

    let status = portable_install_status()?;
    write_portable_install_status_snapshot(&status)?;
    record_app_runtime_event("installer", "uninstall-completed", None);
    Ok(status)
}
