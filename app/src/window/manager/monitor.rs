use super::registry::{
    current_epoch_ms, hidden_window_registry, record_hidden_window_lifecycle_event,
    update_hidden_window_record, HiddenWindowObservation, HIDDEN_WINDOW_MONITOR_INTERVAL_MS,
};
use super::*;
use crate::window::actions::set_window_tool_window_mode;
use crate::window::enumerate::window_owner_matches;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::Duration;

static HIDDEN_WINDOW_MONITOR_RUNTIME: OnceLock<MonitorThreadRuntime> = OnceLock::new();

struct MonitorThreadRuntime {
    stop_requested: Arc<AtomicBool>,
    join_handle: Mutex<Option<JoinHandle<()>>>,
}

pub(super) fn ensure_hidden_window_monitor() {
    let registry = hidden_window_registry();
    let runtime = HIDDEN_WINDOW_MONITOR_RUNTIME.get_or_init(|| MonitorThreadRuntime {
        stop_requested: Arc::new(AtomicBool::new(false)),
        join_handle: Mutex::new(None),
    });
    let Ok(mut join_handle) = runtime.join_handle.lock() else {
        return;
    };

    if join_handle
        .as_ref()
        .is_some_and(|handle| !handle.is_finished())
    {
        return;
    }

    if let Some(finished_handle) = join_handle.take() {
        let _ = finished_handle.join();
    }

    runtime.stop_requested.store(false, Ordering::Release);
    record_app_runtime_event(
        "hidden-window",
        "monitor-thread-started",
        Some(format!("intervalMs={HIDDEN_WINDOW_MONITOR_INTERVAL_MS}")),
    );
    let registry = Arc::clone(&registry);
    let stop_requested = Arc::clone(&runtime.stop_requested);

    *join_handle = thread::Builder::new()
        .name("zlw-hidden-window-monitor".to_string())
        .spawn(move || {
            while !stop_requested.load(Ordering::Acquire) {
                let tracked_hwnds = registry
                    .lock()
                    .map(|values| {
                        values
                            .values()
                            .map(|record| (record.hwnd, record.owner_process_id))
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();

                for (hwnd, owner_process_id) in tracked_hwnds {
                    let handle = HWND(hwnd as *mut _);

                    if !unsafe { IsWindow(handle).as_bool() }
                        || !window_owner_matches(hwnd, owner_process_id)
                    {
                        record_hidden_window_lifecycle_event(
                            hwnd,
                            "monitor-drop-owner-mismatch",
                            Some(format!("expectedProcessId={owner_process_id}")),
                        );
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

                sleep_until_stop(
                    &stop_requested,
                    Duration::from_millis(HIDDEN_WINDOW_MONITOR_INTERVAL_MS),
                );
            }
            record_app_runtime_event("hidden-window", "monitor-thread-exited", None);
        })
        .ok();
}

pub(super) fn shutdown_hidden_window_monitor() {
    let Some(runtime) = HIDDEN_WINDOW_MONITOR_RUNTIME.get() else {
        return;
    };
    runtime.stop_requested.store(true, Ordering::Release);
    let join_handle = runtime
        .join_handle
        .lock()
        .ok()
        .and_then(|mut handle| handle.take());

    if let Some(join_handle) = join_handle {
        let _ = join_handle.join();
    }
}

fn sleep_until_stop(stop_requested: &AtomicBool, duration: Duration) {
    let step = Duration::from_millis(10);
    let mut remaining = duration;

    while remaining > Duration::ZERO && !stop_requested.load(Ordering::Acquire) {
        let current = remaining.min(step);
        thread::sleep(current);
        remaining = remaining.saturating_sub(current);
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn monitor_sleep_returns_immediately_after_cancellation() {
        let stop_requested = AtomicBool::new(true);
        let started_at = Instant::now();

        sleep_until_stop(&stop_requested, Duration::from_secs(1));

        assert!(started_at.elapsed() < Duration::from_millis(100));
    }
}
