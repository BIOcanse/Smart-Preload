use super::*;
use std::collections::HashSet;

use sysinfo::System;

use crate::telemetry::is_google_chrome_browser_process;

struct EnumContext {
    windows: Vec<ChromeWindowInfo>,
    chrome_process_ids: HashSet<u32>,
}

pub(crate) fn enumerate_chrome_windows() -> Vec<ChromeWindowInfo> {
    let chrome_process_ids = collect_google_chrome_process_ids();
    let context = Mutex::new(EnumContext {
        windows: Vec::new(),
        chrome_process_ids,
    });

    unsafe {
        let _ = EnumWindows(
            Some(enum_windows_callback),
            LPARAM(&context as *const _ as isize),
        );
    }

    context
        .into_inner()
        .unwrap_or_else(|e| e.into_inner())
        .windows
}

pub(crate) fn find_chrome_window(request: &HideWindowRequest) -> Option<ChromeWindowInfo> {
    let windows = enumerate_chrome_windows();

    if let Some(target_hwnd) = request.hwnd {
        return windows.into_iter().find(|w| w.hwnd == target_hwnd);
    }

    let mut candidates: Vec<ChromeWindowInfo> = windows
        .into_iter()
        .filter(|w| {
            if let Some(ref title_sub) = request.title_contains {
                if !w.title.contains(title_sub.as_str()) {
                    return false;
                }
            }

            if let Some(left) = request.left {
                if (w.left - left).abs() > 10 {
                    return false;
                }
            }
            if let Some(top) = request.top {
                if (w.top - top).abs() > 10 {
                    return false;
                }
            }
            if let Some(width) = request.width {
                if (w.width - width).abs() > 10 {
                    return false;
                }
            }
            if let Some(height) = request.height {
                if (w.height - height).abs() > 10 {
                    return false;
                }
            }

            true
        })
        .collect();

    candidates.sort_by_key(|w| std::cmp::Reverse(w.visible as u8));
    candidates.into_iter().next()
}

unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let context = unsafe { &*(lparam.0 as *const Mutex<EnumContext>) };

    let class_name = unsafe { get_window_class_name(hwnd) };
    if class_name != CHROME_WINDOW_CLASS {
        return TRUE;
    }

    let mut process_id = 0_u32;
    unsafe {
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));
    }

    if !context
        .lock()
        .map(|ctx| ctx.chrome_process_ids.contains(&process_id))
        .unwrap_or(false)
    {
        return TRUE;
    }

    let mut rect = RECT::default();
    let _ = unsafe { GetWindowRect(hwnd, &mut rect) };

    let info = ChromeWindowInfo {
        hwnd: hwnd.0 as u64,
        title: unsafe { get_window_title(hwnd) },
        class_name,
        left: rect.left,
        top: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
        visible: unsafe { IsWindowVisible(hwnd).as_bool() },
        minimized: (unsafe { GetWindowLongW(hwnd, GWL_STYLE) } & WS_MINIMIZE.0 as i32) != 0,
        tool_window: (unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) } & WS_EX_TOOLWINDOW.0 as i32)
            != 0,
    };

    if let Ok(mut ctx) = context.lock() {
        ctx.windows.push(info);
    }

    TRUE
}

fn collect_google_chrome_process_ids() -> HashSet<u32> {
    let mut system = System::new_all();
    system.refresh_all();

    system
        .processes()
        .values()
        .filter(|process| is_google_chrome_browser_process(process))
        .map(|process| process.pid().as_u32())
        .collect()
}

unsafe fn get_window_class_name(hwnd: HWND) -> String {
    let mut buffer = [0u16; 256];
    let length = unsafe { GetClassNameW(hwnd, &mut buffer) };
    if length == 0 {
        return String::new();
    }
    OsString::from_wide(&buffer[..length as usize])
        .to_string_lossy()
        .to_string()
}

unsafe fn get_window_title(hwnd: HWND) -> String {
    let length = unsafe { GetWindowTextLengthW(hwnd) };
    if length == 0 {
        return String::new();
    }
    let mut buffer = vec![0u16; (length + 1) as usize];
    let copied = unsafe { GetWindowTextW(hwnd, &mut buffer) };
    if copied == 0 {
        return String::new();
    }
    OsString::from_wide(&buffer[..copied as usize])
        .to_string_lossy()
        .to_string()
}
