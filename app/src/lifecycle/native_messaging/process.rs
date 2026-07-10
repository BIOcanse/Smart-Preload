use super::super::{current_executable, write_native_wake_marker, HOST_ARGUMENT};
use anyhow::{Context, Result};

const CREATE_NO_WINDOW_FLAG: u32 = 0x0800_0000;
const DETACHED_PROCESS_FLAG: u32 = 0x0000_0008;

pub(super) fn spawn_host_process() -> Result<()> {
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
    use std::process::{Command, Stdio};

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
    let startup_info = STARTUPINFOW {
        cb: size_of::<STARTUPINFOW>() as u32,
        ..Default::default()
    };
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
