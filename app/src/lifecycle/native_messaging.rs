use super::*;
use crate::runtime_debug::record_app_runtime_event;
use serde_json::json;
use std::io::{self, Write};
#[cfg(not(windows))]
use std::process::{Command, Stdio};

const CHROME_NATIVE_MESSAGING_REGISTRY_PATH: &str =
    "Software\\Google\\Chrome\\NativeMessagingHosts";
const CREATE_NO_WINDOW_FLAG: u32 = 0x0800_0000;
const DETACHED_PROCESS_FLAG: u32 = 0x0000_0008;

pub(crate) fn ensure_native_messaging_registration(extension_id: &str) -> Result<PathBuf> {
    disable_watcher_registration()?;

    let manifest_path = native_messaging_manifest_path()?;
    ensure_portable_parent_dir(&manifest_path)?;

    let manifest = json!({
        "name": NATIVE_MESSAGING_HOST_NAME,
        "description": "Zero-Latency Web portable local app launcher",
        "path": current_executable()?.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": [
            format!("chrome-extension://{extension_id}/")
        ]
    });

    fs::write(&manifest_path, serde_json::to_vec_pretty(&manifest)?)
        .with_context(|| format!("failed to write {}", manifest_path.display()))?;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (hosts_key, _) = hkcu
        .create_subkey(CHROME_NATIVE_MESSAGING_REGISTRY_PATH)
        .context("failed to open Chrome NativeMessagingHosts registry key")?;
    let (host_key, _) = hosts_key
        .create_subkey(NATIVE_MESSAGING_HOST_NAME)
        .context("failed to create Chrome native messaging host registry key")?;
    host_key
        .set_value("", &manifest_path.to_string_lossy().to_string())
        .context("failed to register Chrome native messaging host manifest")?;

    record_app_runtime_event(
        "native-messaging",
        "registration-ensured",
        Some(format!("{extension_id}::{}", manifest_path.display())),
    );

    Ok(manifest_path)
}

pub(crate) fn run_native_messaging_host() -> Result<()> {
    record_app_runtime_event("native-messaging", "wake-received", None);

    let response = match spawn_host_process() {
        Ok(()) => {
            record_app_runtime_event("native-messaging", "host-spawn-requested", None);
            json!({
                "ok": true,
                "host": NATIVE_MESSAGING_HOST_NAME,
                "action": "wake-host"
            })
        }
        Err(error) => {
            record_app_runtime_event(
                "native-messaging",
                "host-spawn-failed",
                Some(error.to_string()),
            );
            json!({
                "ok": false,
                "host": NATIVE_MESSAGING_HOST_NAME,
                "error": error.to_string()
            })
        }
    };

    write_native_message(&response)?;
    Ok(())
}

pub(crate) fn remove_native_messaging_registration() -> Result<()> {
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

pub(crate) fn native_messaging_registration_status() -> Result<(Option<String>, PathBuf, bool)> {
    let registry_value = read_native_messaging_registry_value()?;
    let manifest_path = native_messaging_manifest_path()?;
    let manifest_exists = manifest_path.exists();
    Ok((registry_value, manifest_path, manifest_exists))
}

fn read_native_messaging_registry_value() -> Result<Option<String>> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(hosts_key) = hkcu.open_subkey(CHROME_NATIVE_MESSAGING_REGISTRY_PATH) else {
        return Ok(None);
    };
    let Ok(host_key) = hosts_key.open_subkey(NATIVE_MESSAGING_HOST_NAME) else {
        return Ok(None);
    };
    let value: String = host_key.get_value("").unwrap_or_default();
    Ok((!value.trim().is_empty()).then_some(value))
}

fn spawn_host_process() -> Result<()> {
    write_native_wake_marker()?;

    #[cfg(windows)]
    {
        spawn_host_process_windows()
    }

    #[cfg(not(windows))]
    {
        spawn_host_process_standard()
    }
}

#[cfg(not(windows))]
fn spawn_host_process_standard() -> Result<()> {
    Command::new(current_executable()?)
        .arg(HOST_ARGUMENT)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .context("failed to spawn local app host process")?;

    Ok(())
}

#[cfg(windows)]
fn spawn_host_process_windows() -> Result<()> {
    use std::ffi::OsStr;
    use std::mem::size_of;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        CreateProcessW, PROCESS_CREATION_FLAGS, PROCESS_INFORMATION, STARTUPINFOW,
    };

    let executable_path = current_executable()?;
    let command_line = format!("\"{}\" {}", executable_path.display(), HOST_ARGUMENT);
    let mut command_line_wide = OsStr::new(&command_line)
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<u16>>();
    let working_directory = executable_path.parent().map(|path| {
        path.as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<u16>>()
    });
    let working_directory_ptr = working_directory
        .as_ref()
        .map(|value| PCWSTR(value.as_ptr()))
        .unwrap_or_else(PCWSTR::null);
    let mut startup_info = STARTUPINFOW::default();
    startup_info.cb = size_of::<STARTUPINFOW>() as u32;
    let mut process_info = PROCESS_INFORMATION::default();
    let creation_flags = PROCESS_CREATION_FLAGS(CREATE_NO_WINDOW_FLAG | DETACHED_PROCESS_FLAG);

    unsafe {
        CreateProcessW(
            PCWSTR::null(),
            PWSTR(command_line_wide.as_mut_ptr()),
            None,
            None,
            false,
            creation_flags,
            None,
            working_directory_ptr,
            &startup_info,
            &mut process_info,
        )
        .context("failed to spawn local app host process")?;

        let _ = CloseHandle(process_info.hThread);
        let _ = CloseHandle(process_info.hProcess);
    }

    Ok(())
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
