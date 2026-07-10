use super::actions::{close_window_now, hide_window_now, show_window_now};
use super::enumerate::{find_chrome_window, window_owner_matches};
use super::*;
use crate::runtime_debug::record_app_runtime_event;

mod hooks;
mod monitor;
mod registry;
mod snapshot;

use registry::{
    is_tracked_hidden_window, record_hidden_window_lifecycle_event, track_hidden_window,
    tracked_hidden_window_hwnds, tracked_hidden_window_owner_process_id, untrack_hidden_window,
    HiddenWindowHideMatchObservation,
};

// This module is the explicit WindowManager boundary. Ongoing hidden-window
// policy and monitoring belong here; lower Win32 actions stay in actions.rs.

pub(super) fn hidden_window_monitor_snapshot() -> HiddenWindowMonitorSnapshot {
    snapshot::hidden_window_monitor_snapshot()
}

pub(super) fn shutdown_hidden_window_runtime() {
    hooks::shutdown_hidden_window_event_hooks();
    monitor::shutdown_hidden_window_monitor();
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

        let owner_matches = tracked_hidden_window_owner_process_id(hwnd)
            .is_some_and(|process_id| window_owner_matches(hwnd, process_id));

        if !owner_matches {
            record_hidden_window_lifecycle_event(
                hwnd,
                "close-skipped-owner-mismatch",
                Some(reason.to_string()),
            );
            untrack_hidden_window(hwnd);
            record_app_runtime_event(
                "hidden-window",
                "close-skipped-owner-mismatch",
                Some(format!("hwnd={hwnd} reason={reason}")),
            );
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

pub(super) fn hide_chrome_window(
    process_sampler: &SystemProcessSampler,
    request: &HideWindowRequest,
) -> HideWindowResponse {
    match find_chrome_window(process_sampler, request) {
        Ok(window) if !window_owner_matches(window.hwnd, window.process_id) => {
            record_app_runtime_event(
                "hidden-window",
                "hide-request-owner-changed-before-action",
                Some(format!(
                    "hwnd={} expectedProcessId={}",
                    window.hwnd, window.process_id
                )),
            );
            HideWindowResponse {
                ok: false,
                hwnd: Some(window.hwnd),
                error: Some("window ownership changed before hide".to_string()),
            }
        }
        Ok(window) => match hide_window_now(window.hwnd) {
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
                track_hidden_window(&window, pre_hide_observation);
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
        Err(error) => HideWindowResponse {
            ok: false,
            hwnd: request.hwnd,
            error: Some({
                record_app_runtime_event(
                    "hidden-window",
                    "hide-request-rejected-window",
                    Some(error.to_string()),
                );
                error.to_string()
            }),
        },
    }
}

pub(super) fn show_chrome_window(request: &ShowWindowRequest) -> ShowWindowResponse {
    let owner_matches = tracked_hidden_window_owner_process_id(request.hwnd)
        .is_some_and(|process_id| window_owner_matches(request.hwnd, process_id));

    if !owner_matches {
        untrack_hidden_window(request.hwnd);
        record_app_runtime_event(
            "hidden-window",
            "show-request-rejected-untracked-or-owner-mismatch",
            Some(format!("hwnd={}", request.hwnd)),
        );
        return ShowWindowResponse {
            ok: false,
            hwnd: Some(request.hwnd),
            error: Some("window is not a verified tracked preload window".to_string()),
        };
    }

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
