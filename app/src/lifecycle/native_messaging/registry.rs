use super::super::NATIVE_MESSAGING_HOST_NAME;
use anyhow::{Context, Result};
use std::path::PathBuf;
use winreg::enums::{HKEY_CURRENT_USER, KEY_WRITE};
use winreg::RegKey;

const NATIVE_MESSAGING_REGISTRY_PATHS: [(&str, &str); 2] = [
    ("Chrome", "Software\\Google\\Chrome\\NativeMessagingHosts"),
    ("Edge", "Software\\Microsoft\\Edge\\NativeMessagingHosts"),
];

pub(super) fn ensure_native_messaging_registry_entries(manifest_path: &PathBuf) -> Result<()> {
    for (browser_name, registry_path) in NATIVE_MESSAGING_REGISTRY_PATHS {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (hosts_key, _) = hkcu.create_subkey(registry_path).with_context(|| {
            format!("failed to open {browser_name} NativeMessagingHosts registry key")
        })?;
        let (host_key, _) = hosts_key
            .create_subkey(NATIVE_MESSAGING_HOST_NAME)
            .with_context(|| {
                format!("failed to create {browser_name} native messaging host registry key")
            })?;
        host_key
            .set_value("", &manifest_path.to_string_lossy().to_string())
            .with_context(|| {
                format!("failed to register {browser_name} native messaging host manifest")
            })?;
    }

    Ok(())
}

pub(super) fn remove_native_messaging_registry_entries() -> Result<()> {
    for (browser_name, registry_path) in NATIVE_MESSAGING_REGISTRY_PATHS {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        if let Ok(hosts_key) = hkcu.open_subkey_with_flags(registry_path, KEY_WRITE) {
            match hosts_key.delete_subkey(NATIVE_MESSAGING_HOST_NAME) {
                Ok(()) => {
                    crate::runtime_debug::record_app_runtime_event(
                        "native-messaging",
                        "registration-removed",
                        Some(browser_name.to_owned()),
                    );
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(error).with_context(|| {
                        format!("failed to remove {browser_name} native messaging host key")
                    });
                }
            }
        }
    }

    Ok(())
}

pub(super) fn read_native_messaging_registry_value() -> Result<Option<String>> {
    for (_browser_name, registry_path) in NATIVE_MESSAGING_REGISTRY_PATHS {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let Ok(hosts_key) = hkcu.open_subkey(registry_path) else {
            continue;
        };
        let Ok(host_key) = hosts_key.open_subkey(NATIVE_MESSAGING_HOST_NAME) else {
            continue;
        };
        let value: String = host_key.get_value("").unwrap_or_default();

        if !value.trim().is_empty() {
            return Ok(Some(value));
        }
    }

    Ok(None)
}
