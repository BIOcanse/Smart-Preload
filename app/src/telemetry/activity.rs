use serde::Serialize;
use sysinfo::System;

#[cfg(windows)]
use windows::Win32::Foundation::{HWND, RECT};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetSystemMetrics, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsWindowVisible, SYSTEM_METRICS_INDEX,
};

use super::{chrono_like_now, is_google_chrome_browser_process};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySnapshot {
    pub generated_at: String,
    pub chrome_running: bool,
    pub foreground: Option<ForegroundWindowSnapshot>,
    pub non_chrome_fullscreen: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundWindowSnapshot {
    pub hwnd: u64,
    pub process_id: u32,
    pub process_name: Option<String>,
    pub title: String,
    pub is_chrome: bool,
    pub fullscreen_like: bool,
}

pub fn collect_activity_snapshot() -> ActivitySnapshot {
    let mut system = System::new_all();
    system.refresh_all();
    let chrome_running = system
        .processes()
        .values()
        .any(is_google_chrome_browser_process);
    let foreground = collect_foreground_window_snapshot(&system);
    let non_chrome_fullscreen = foreground
        .as_ref()
        .map(|window| window.fullscreen_like && !window.is_chrome)
        .unwrap_or(false);

    ActivitySnapshot {
        generated_at: chrono_like_now(),
        chrome_running,
        foreground,
        non_chrome_fullscreen,
    }
}

#[cfg(windows)]
fn collect_foreground_window_snapshot(system: &System) -> Option<ForegroundWindowSnapshot> {
    let hwnd = unsafe { GetForegroundWindow() };

    if hwnd.0.is_null() || !unsafe { IsWindowVisible(hwnd) }.as_bool() {
        return None;
    }

    let process_id = unsafe {
        let mut process_id = 0_u32;
        GetWindowThreadProcessId(hwnd, Some(&mut process_id));
        process_id
    };
    let process = system
        .processes()
        .values()
        .find(|process| process.pid().as_u32() == process_id);
    let process_name = process.map(|process| process.name().to_string_lossy().to_string());
    let is_chrome = process
        .map(is_google_chrome_browser_process)
        .unwrap_or(false);
    let title = unsafe { get_window_title(hwnd) };
    let fullscreen_like = unsafe { is_fullscreen_like(hwnd) };

    Some(ForegroundWindowSnapshot {
        hwnd: hwnd.0 as usize as u64,
        process_id,
        process_name,
        title,
        is_chrome,
        fullscreen_like,
    })
}

#[cfg(not(windows))]
fn collect_foreground_window_snapshot(_system: &System) -> Option<ForegroundWindowSnapshot> {
    None
}

#[cfg(windows)]
unsafe fn is_fullscreen_like(hwnd: HWND) -> bool {
    let mut rect = RECT::default();

    if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
        return false;
    }

    let screen_width = unsafe { GetSystemMetrics(SYSTEM_METRICS_INDEX(0)) };
    let screen_height = unsafe { GetSystemMetrics(SYSTEM_METRICS_INDEX(1)) };

    rect.left <= 0 && rect.top <= 0 && rect.right >= screen_width && rect.bottom >= screen_height
}

#[cfg(windows)]
unsafe fn get_window_title(hwnd: HWND) -> String {
    let length = unsafe { GetWindowTextLengthW(hwnd) };

    if length <= 0 {
        return String::new();
    }

    let mut buffer = vec![0_u16; length as usize + 1];
    let copied = unsafe { GetWindowTextW(hwnd, &mut buffer) };

    String::from_utf16_lossy(&buffer[..copied as usize])
}
