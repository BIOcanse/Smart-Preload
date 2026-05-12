use super::*;
// This file now stays at the Win32 action layer. High-level hidden-window
// policy and monitor ownership live in manager.rs.

pub(super) fn set_window_tool_window_mode(hwnd: u64, enabled: bool) -> Result<()> {
    let handle = HWND(hwnd as *mut _);
    let current_ex_style = unsafe { GetWindowLongW(handle, GWL_EXSTYLE) };
    let tool_window_flag = WS_EX_TOOLWINDOW.0 as i32;
    let next_ex_style = if enabled {
        current_ex_style | tool_window_flag
    } else {
        current_ex_style & !tool_window_flag
    };

    if next_ex_style == current_ex_style {
        return Ok(());
    }

    unsafe {
        SetWindowLongW(handle, GWL_EXSTYLE, next_ex_style);
        SetWindowPos(
            handle,
            HWND::default(),
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        )
        .ok()
        .context("SetWindowPos(frame-changed) failed")?;
    }

    Ok(())
}

pub(super) fn hide_window_now(hwnd: u64) -> Result<()> {
    let handle = HWND(hwnd as *mut _);
    set_window_tool_window_mode(hwnd, true)?;
    let _ = unsafe { ShowWindow(handle, SW_HIDE) };
    Ok(())
}

pub(super) fn show_window_now(hwnd: u64) -> Result<()> {
    let handle = HWND(hwnd as *mut _);
    set_window_tool_window_mode(hwnd, false)?;
    let _ = unsafe { ShowWindow(handle, SW_SHOWNA) };
    Ok(())
}

pub(super) fn close_window_now(hwnd: u64) -> Result<()> {
    let handle = HWND(hwnd as *mut _);

    if !unsafe { IsWindow(handle).as_bool() } {
        return Ok(());
    }

    unsafe { PostMessageW(handle, WM_CLOSE, WPARAM(0), LPARAM(0)) }
        .ok()
        .context("PostMessageW(WM_CLOSE) failed")?;
    Ok(())
}
