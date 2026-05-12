use super::registry::{
    current_epoch_ms, hidden_window_registry, record_hidden_window_lifecycle_event,
    update_hidden_window_record, HiddenWindowObservation, HIDDEN_WINDOW_MONITOR_INTERVAL_MS,
};
use super::*;
use crate::window::actions::set_window_tool_window_mode;
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::Duration;

static HIDDEN_WINDOW_MONITOR_STARTED: OnceLock<()> = OnceLock::new();

pub(super) fn ensure_hidden_window_monitor() {
    let registry = hidden_window_registry();

    HIDDEN_WINDOW_MONITOR_STARTED.get_or_init(|| {
        record_app_runtime_event(
            "hidden-window",
            "monitor-thread-started",
            Some(format!("intervalMs={HIDDEN_WINDOW_MONITOR_INTERVAL_MS}")),
        );
        let registry = Arc::clone(&registry);

        thread::spawn(move || loop {
            let tracked_hwnds = registry
                .lock()
                .map(|values| values.keys().copied().collect::<Vec<u64>>())
                .unwrap_or_default();

            for hwnd in tracked_hwnds {
                let handle = HWND(hwnd as *mut _);

                if !unsafe { IsWindow(handle).as_bool() } {
                    record_hidden_window_lifecycle_event(hwnd, "monitor-drop-missing-window", None);
                    if let Ok(mut tracked_values) = registry.lock() {
                        tracked_values.remove(&hwnd);
                    }
                    continue;
                }

                let now_ms = current_epoch_ms();
                let observation = observe_hidden_window(hwnd);

                if let Some(observation) = observation {
                    let should_rehide = observation.visible || !observation.tool_window;

                    if let Ok(mut tracked_values) = registry.lock() {
                        if let Some(record) = tracked_values.get_mut(&hwnd) {
                            update_hidden_window_record(record, observation, now_ms);

                            if should_rehide {
                                record.last_force_hide_at_ms = Some(now_ms);
                            }
                        }
                    }

                    if should_rehide {
                        record_hidden_window_lifecycle_event(
                            hwnd,
                            "monitor-rehide",
                            Some(format!(
                                "visible={} toolWindow={}",
                                observation.visible, observation.tool_window
                            )),
                        );
                        let _ = set_window_tool_window_mode(hwnd, true);
                        let _ = hide_window_now(hwnd);
                    }
                }
            }

            thread::sleep(Duration::from_millis(HIDDEN_WINDOW_MONITOR_INTERVAL_MS));
        });
    });
}

pub(super) fn observe_hidden_window(hwnd: u64) -> Option<HiddenWindowObservation> {
    let handle = HWND(hwnd as *mut _);

    if !unsafe { IsWindow(handle).as_bool() } {
        return None;
    }

    let mut rect = RECT::default();
    let _ = unsafe { GetWindowRect(handle, &mut rect) };
    let visible = unsafe { IsWindowVisible(handle).as_bool() };
    let tool_window =
        (unsafe { GetWindowLongW(handle, GWL_EXSTYLE) } & WS_EX_TOOLWINDOW.0 as i32) != 0;

    Some(HiddenWindowObservation {
        visible,
        on_screen: visible && rect_intersects_virtual_screen(rect),
        tool_window,
    })
}

pub(super) fn rect_intersects_virtual_screen(rect: RECT) -> bool {
    let virtual_left = unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) };
    let virtual_top = unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) };
    let virtual_right = virtual_left + unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) };
    let virtual_bottom = virtual_top + unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) };

    rect.right > virtual_left
        && rect.left < virtual_right
        && rect.bottom > virtual_top
        && rect.top < virtual_bottom
}
