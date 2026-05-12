use super::actions::{close_window_now, hide_window_now, show_window_now};
use super::enumerate::find_chrome_window;
use super::*;
use crate::runtime_debug::record_app_runtime_event;

mod hooks;
mod monitor;
mod registry;
mod snapshot;

use registry::{
    is_tracked_hidden_window, record_hidden_window_lifecycle_event, track_hidden_window,
    tracked_hidden_window_hwnds, untrack_hidden_window, HiddenWindowHideMatchObservation,
};

// This module is the explicit WindowManager boundary. Ongoing hidden-window
// policy and monitoring belong here; lower Win32 actions stay in actions.rs.

pub(super) fn hidden_window_monitor_snapshot() -> HiddenWindowMonitorSnapshot {
    snapshot::hidden_window_monitor_snapshot()
}

pub(super) fn close_tracked_hidden_windows(reason: &str) -> usize {
    let hwnds = tracked_hidden_window_hwnds();
    close_tracked_hidden_windows_by_hwnds(&hwnds, reason)
}

pub(super) fn close_tracked_hidden_windows_by_hwnds(hwnds: &[u64], reason: &str) -> usize {
    let mut closed_count = 0;

    for hwnd in unique_positive_hwnds(hwnds) {
        if !is_tracked_hidden_window(hwnd) {
            continue;
        }

        match close_window_now(hwnd) {
            Ok(()) => {
                closed_count += 1;
                record_hidden_window_lifecycle_event(
                    hwnd,
                    "close-tracked-hidden-window",
                    Some(reason.to_string()),
                );
                untrack_hidden_window(hwnd);
                record_app_runtime_event(
                    "hidden-window",
                    "close-tracked-hidden-window",
                    Some(format!("hwnd={hwnd} reason={reason}")),
                );
            }
            Err(error) => {
                record_hidden_window_lifecycle_event(
                    hwnd,
                    "close-tracked-hidden-window-failed",
                    Some(format!("reason={reason} error={error}")),
                );
                record_app_runtime_event(
                    "hidden-window",
                    "close-tracked-hidden-window-failed",
                    Some(format!("hwnd={hwnd} reason={reason} error={error}")),
                );
            }
        }
    }

    closed_count
}

fn unique_positive_hwnds(hwnds: &[u64]) -> Vec<u64> {
    let mut values: Vec<u64> = hwnds.iter().copied().filter(|hwnd| *hwnd > 0).collect();
    values.sort_unstable();
    values.dedup();
    values
}

pub(super) fn hide_chrome_window(request: &HideWindowRequest) -> HideWindowResponse {
    match find_chrome_window(request) {
        Some(window) => match hide_window_now(window.hwnd) {
            Ok(()) => {
                let pre_hide_observation = HiddenWindowHideMatchObservation {
                    visible: window.visible,
                    on_screen: window.visible
                        && monitor::rect_intersects_virtual_screen(RECT {
                            left: window.left,
                            top: window.top,
                            right: window.left + window.width,
                            bottom: window.top + window.height,
                        }),
                    tool_window: window.tool_window,
                };
                monitor::ensure_hidden_window_monitor();
                hooks::ensure_hidden_window_event_hooks();
                track_hidden_window(window.hwnd, pre_hide_observation);
                record_hidden_window_lifecycle_event(
                    window.hwnd,
                    "hide-request-succeeded",
                    Some(window.title.clone()),
                );
                tracing::info!(hwnd = window.hwnd, title = %window.title, "hid Chrome window");
                record_app_runtime_event(
                    "hidden-window",
                    "hide-request-succeeded",
                    Some(format!("hwnd={} title={}", window.hwnd, window.title)),
                );
                HideWindowResponse {
                    ok: true,
                    hwnd: Some(window.hwnd),
                    error: None,
                }
            }
            Err(error) => HideWindowResponse {
                ok: false,
                hwnd: Some(window.hwnd),
                error: Some({
                    record_app_runtime_event(
                        "hidden-window",
                        "hide-request-failed",
                        Some(format!("hwnd={} error={error}", window.hwnd)),
                    );
                    error.to_string()
                }),
            },
        },
        None => HideWindowResponse {
            ok: false,
            hwnd: None,
            error: Some({
                record_app_runtime_event("hidden-window", "hide-request-missed-window", None);
                "no matching Chrome window found".to_string()
            }),
        },
    }
}

pub(super) fn show_chrome_window(request: &ShowWindowRequest) -> ShowWindowResponse {
    match show_window_now(request.hwnd) {
        Ok(()) => {
            record_hidden_window_lifecycle_event(request.hwnd, "show-request-succeeded", None);
            untrack_hidden_window(request.hwnd);
            tracing::info!(hwnd = request.hwnd, "showed Chrome window");
            record_app_runtime_event(
                "hidden-window",
                "show-request-succeeded",
                Some(format!("hwnd={}", request.hwnd)),
            );
            ShowWindowResponse {
                ok: true,
                hwnd: Some(request.hwnd),
                error: None,
            }
        }
        Err(error) => ShowWindowResponse {
            ok: false,
            hwnd: Some(request.hwnd),
            error: Some({
                record_app_runtime_event(
                    "hidden-window",
                    "show-request-failed",
                    Some(format!("hwnd={} error={error}", request.hwnd)),
                );
                error.to_string()
            }),
        },
    }
}
