use super::*;
use crate::runtime_debug::record_app_runtime_event;

pub(crate) fn disable_watcher_registration() -> Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(run_key) = hkcu.open_subkey_with_flags(RUN_KEY_PATH, winreg::enums::KEY_SET_VALUE)
    else {
        return Ok(());
    };

    match run_key.delete_value(RUN_VALUE_NAME) {
        Ok(()) => {
            record_app_runtime_event("watcher", "startup-registration-removed", None);
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).context("failed to remove watcher startup command"),
    }
}

pub(crate) fn cleanup_legacy_watcher_mode() -> Result<()> {
    record_app_runtime_event("watcher", "legacy-watcher-cleanup-entered", None);
    disable_watcher_registration()
}
