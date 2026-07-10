use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::sync::Mutex;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT, TRUE, WPARAM};
use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, EnumWindows, GetClassNameW, GetSystemMetrics, GetWindowLongW, GetWindowRect,
    GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId, IsWindow, IsWindowVisible,
    PeekMessageW, PostMessageW, SetWindowLongW, SetWindowPos, ShowWindow, TranslateMessage,
    EVENT_OBJECT_HIDE, EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_SHOW, EVENT_SYSTEM_FOREGROUND,
    EVENT_SYSTEM_MINIMIZEEND, EVENT_SYSTEM_MINIMIZESTART, GWL_EXSTYLE, GWL_STYLE, MSG, PM_REMOVE,
    SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN, SWP_FRAMECHANGED,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SW_HIDE, SW_SHOWNA,
    WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS, WM_CLOSE, WM_QUIT, WS_EX_TOOLWINDOW,
    WS_MINIMIZE,
};

mod actions;
mod enumerate;
mod manager;

use crate::runtime_debug::AppRuntimeEvent;
use crate::telemetry::SystemProcessSampler;

pub(crate) const CHROME_WINDOW_CLASS: &str = "Chrome_WidgetWin_1";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChromeWindowInfo {
    pub hwnd: u64,
    pub process_id: u32,
    pub process_name: Option<String>,
    pub executable_path: Option<String>,
    pub browser_kind: Option<String>,
    pub title: String,
    pub class_name: String,
    pub left: i32,
    pub top: i32,
    pub width: i32,
    pub height: i32,
    pub visible: bool,
    pub minimized: bool,
    pub tool_window: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HideWindowRequest {
    pub left: Option<i32>,
    pub top: Option<i32>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub title_contains: Option<String>,
    pub browser_family: Option<String>,
    pub hwnd: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HideWindowResponse {
    pub ok: bool,
    pub hwnd: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowWindowResponse {
    pub ok: bool,
    pub hwnd: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowWindowRequest {
    pub hwnd: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HiddenWindowVisibilityEpisode {
    pub visible_started_at_ms: u64,
    pub visible_ended_at_ms: Option<u64>,
    pub sample_count: u64,
    pub estimated_visible_duration_ms: u64,
    pub observed_on_screen: bool,
    pub last_observed_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HiddenWindowMonitorInfo {
    pub hwnd: u64,
    pub owner_process_id: u32,
    pub owner_browser_kind: String,
    pub tracked_since_ms: u64,
    pub first_hide_requested_at_ms: Option<u64>,
    pub last_hide_requested_at_ms: Option<u64>,
    pub hide_request_count: u64,
    pub first_hide_match_visible: bool,
    pub first_hide_match_on_screen: bool,
    pub first_hide_match_tool_window: bool,
    pub currently_visible: bool,
    pub currently_on_screen: bool,
    pub currently_tool_window: bool,
    pub was_visible_since_tracked: bool,
    pub was_on_screen_since_tracked: bool,
    pub was_tool_window_missing_since_tracked: bool,
    pub visible_observation_count: u64,
    pub on_screen_observation_count: u64,
    pub tool_window_missing_observation_count: u64,
    pub estimated_visible_duration_ms: u64,
    pub estimated_on_screen_duration_ms: u64,
    pub estimated_tool_window_missing_duration_ms: u64,
    pub last_observed_at_ms: Option<u64>,
    pub last_seen_visible_at_ms: Option<u64>,
    pub last_seen_on_screen_at_ms: Option<u64>,
    pub last_seen_tool_window_missing_at_ms: Option<u64>,
    pub last_force_hide_at_ms: Option<u64>,
    pub visibility_episodes: Vec<HiddenWindowVisibilityEpisode>,
    pub hook_events: Vec<HiddenWindowHookEvent>,
    pub lifecycle_events: Vec<HiddenWindowLifecycleEvent>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HiddenWindowHookEvent {
    pub recorded_at_ms: u64,
    pub hwnd: u64,
    pub event_code: u32,
    pub event_name: String,
    pub id_object: i32,
    pub id_child: i32,
    pub event_thread_id: u32,
    pub currently_visible: bool,
    pub currently_on_screen: bool,
    pub currently_tool_window: bool,
    pub rehide_requested: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HiddenWindowLifecycleEvent {
    pub recorded_at_ms: u64,
    pub hwnd: u64,
    pub event_name: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HiddenWindowMonitorSnapshot {
    pub generated_at_ms: u64,
    pub monitor_interval_ms: u64,
    pub hook_installed: bool,
    pub hook_last_error: Option<String>,
    pub recent_runtime_events: Vec<AppRuntimeEvent>,
    pub recent_hook_events: Vec<HiddenWindowHookEvent>,
    pub recent_lifecycle_events: Vec<HiddenWindowLifecycleEvent>,
    pub tracked_windows: Vec<HiddenWindowMonitorInfo>,
}

pub fn list_chrome_windows(process_sampler: &SystemProcessSampler) -> Vec<ChromeWindowInfo> {
    enumerate::enumerate_chrome_windows(process_sampler)
}

pub fn request_hide_chrome_window(
    process_sampler: &SystemProcessSampler,
    request: &HideWindowRequest,
) -> HideWindowResponse {
    manager::hide_chrome_window(process_sampler, request)
}

pub fn request_show_chrome_window(request: &ShowWindowRequest) -> ShowWindowResponse {
    manager::show_chrome_window(request)
}

pub fn hidden_window_monitor_snapshot() -> HiddenWindowMonitorSnapshot {
    manager::hidden_window_monitor_snapshot()
}

pub fn shutdown_hidden_window_runtime() {
    manager::shutdown_hidden_window_runtime()
}

pub fn close_tracked_hidden_windows(reason: &str) -> usize {
    manager::close_tracked_hidden_windows(reason)
}

pub fn close_tracked_hidden_windows_by_hwnds(hwnds: &[u64], reason: &str) -> usize {
    manager::close_tracked_hidden_windows_by_hwnds(hwnds, reason)
}
