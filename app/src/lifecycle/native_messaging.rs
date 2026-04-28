use super::*;
use crate::runtime_debug::record_app_runtime_event;
use serde_json::json;
use std::io::{self, Write};

const CHROME_NATIVE_MESSAGING_REGISTRY_PATH: &str =
    "Software\\Google\\Chrome\\NativeMessagingHosts";

pub(crate) fn cleanup_native_messaging_registration() -> Result<()> {
    disable_watcher_registration()?;
    remove_native_messaging_registration()?;
    record_app_runtime_event("native-messaging", "registration-cleaned", None);
    Ok(())
}

pub(crate) fn run_native_messaging_host() -> Result<()> {
    record_app_runtime_event("native-messaging", "wake-received-disabled", None);
    cleanup_native_messaging_registration()?;

    let response = json!({
        "ok": false,
        "host": NATIVE_MESSAGING_HOST_NAME,
        "error": "native messaging startup is disabled; start the local app process directly"
    });

    write_native_message(&response)?;
    Ok(())
}

fn remove_native_messaging_registration() -> Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(hosts_key) = hkcu.open_subkey_with_flags(
        CHROME_NATIVE_MESSAGING_REGISTRY_PATH,
        winreg::enums::KEY_WRITE,
    ) {
        match hosts_key.delete_subkey(NATIVE_MESSAGING_HOST_NAME) {
            Ok(()) => {
                record_app_runtime_event("native-messaging", "registration-removed", None);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(error).context("failed to remove Chrome native messaging host key");
            }
        }
    }

    let manifest_path = native_messaging_manifest_path()?;
    if manifest_path.exists() {
        fs::remove_file(&manifest_path)
            .with_context(|| format!("failed to remove {}", manifest_path.display()))?;
        record_app_runtime_event(
            "native-messaging",
            "manifest-removed",
            Some(manifest_path.display().to_string()),
        );
    }

    Ok(())
}

fn native_messaging_manifest_path() -> Result<PathBuf> {
    portable_path(&format!(
        "native-messaging\\{NATIVE_MESSAGING_HOST_NAME}.json"
    ))
}

fn write_native_message(value: &serde_json::Value) -> Result<()> {
    let payload = serde_json::to_vec(value)?;
    let length = u32::try_from(payload.len()).context("native messaging response is too large")?;
    let mut stdout = io::stdout();
    stdout.write_all(&length.to_le_bytes())?;
    stdout.write_all(&payload)?;
    stdout.flush()?;
    Ok(())
}
