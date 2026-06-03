mod origin;
mod registry;
mod status;

use crate::runtime_debug::record_app_runtime_event;

use super::{
    disable_watcher_registration, native_messaging, registered_extension_ids, target_extension_ids,
};
use anyhow::Result;
pub(crate) use status::{
    portable_install_status, write_portable_install_status_snapshot, PortableInstallStatus,
};

pub(crate) fn install_portable_app() -> Result<PortableInstallStatus> {
    disable_watcher_registration()?;
    registry::write_app_registration()?;

    let extension_ids = install_extension_ids();

    if !extension_ids.is_empty() {
        origin::persist_allowed_extension_origins(&extension_ids)?;
        let manifest_path = native_messaging::ensure_native_messaging_registration(&extension_ids)?;
        registry::write_native_messaging_app_registration(&extension_ids, &manifest_path)?;
        record_app_runtime_event(
            "installer",
            "native-messaging-registered",
            Some(format!(
                "{}::{}",
                extension_ids.join(","),
                manifest_path.display()
            )),
        );
    } else {
        record_app_runtime_event(
            "installer",
            "native-messaging-preserved-extension-missing",
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

fn install_extension_ids() -> Vec<String> {
    let mut extension_ids = target_extension_ids();

    if extension_ids.is_empty() {
        extension_ids = registered_extension_ids();
    }

    if extension_ids.is_empty() {
        if let Some(extension_id) = registry::read_app_registration()
            .ok()
            .and_then(|registration| registration.extension_id)
        {
            extension_ids.push(extension_id);
        }
    }

    extension_ids.sort();
    extension_ids.dedup();
    extension_ids
}
