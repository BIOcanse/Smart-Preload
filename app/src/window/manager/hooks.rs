use super::monitor::observe_hidden_window;
use super::registry::{
    current_epoch_ms, hidden_window_hook_runtime, hidden_window_registry,
    push_hidden_window_hook_event, record_hidden_window_lifecycle_event,
    MAX_HOOK_EVENTS_PER_WINDOW, MAX_RECENT_HOOK_EVENTS,
};
use super::*;
use crate::window::actions::set_window_tool_window_mode;
use crate::window::enumerate::window_owner_matches;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::Duration;

static HIDDEN_WINDOW_HOOK_RUNTIME: OnceLock<HookThreadRuntime> = OnceLock::new();

struct HookThreadRuntime {
    stop_requested: Arc<AtomicBool>,
    join_handle: Mutex<Option<JoinHandle<()>>>,
}

pub(super) fn ensure_hidden_window_event_hooks() {
    let hook_runtime = hidden_window_hook_runtime();
    let thread_runtime = HIDDEN_WINDOW_HOOK_RUNTIME.get_or_init(|| HookThreadRuntime {
        stop_requested: Arc::new(AtomicBool::new(false)),
        join_handle: Mutex::new(None),
    });
    let Ok(mut join_handle) = thread_runtime.join_handle.lock() else {
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

    thread_runtime
        .stop_requested
        .store(false, Ordering::Release);
    record_app_runtime_event("hidden-window", "hook-thread-started", None);
    let hook_runtime = Arc::clone(&hook_runtime);
    let stop_requested = Arc::clone(&thread_runtime.stop_requested);

    *join_handle = thread::Builder::new()
        .name("zlw-hidden-window-hooks".to_string())
        .spawn(move || {
            let hooks = match install_hidden_window_event_hooks() {
                Ok(hooks) => {
                    record_app_runtime_event("hidden-window", "hook-install-succeeded", None);
                    if let Ok(mut runtime) = hook_runtime.lock() {
                        runtime.installed = true;
                        runtime.last_error = None;
                    }
                    hooks
                }
                Err(error) => {
                    record_app_runtime_event(
                        "hidden-window",
                        "hook-install-failed",
                        Some(error.to_string()),
                    );
                    if let Ok(mut runtime) = hook_runtime.lock() {
                        runtime.installed = false;
                        runtime.last_error = Some(error.to_string());
                    }
                    tracing::error!(error = %error, "failed to install hidden-window event hooks");
                    return;
                }
            };

            let mut message = MSG::default();

            'message_loop: while !stop_requested.load(Ordering::Acquire) {
                let mut dispatched_message = false;

                while unsafe {
                    PeekMessageW(&mut message, HWND::default(), 0, 0, PM_REMOVE).as_bool()
                } {
                    dispatched_message = true;

                    if message.message == WM_QUIT {
                        break 'message_loop;
                    }

                    unsafe {
                        let _ = TranslateMessage(&message);
                        DispatchMessageW(&message);
                    }
                }

                if !dispatched_message {
                    thread::sleep(Duration::from_millis(20));
                }
            }

            for hook in hooks {
                let _ = unsafe { UnhookWinEvent(hook) };
            }

            if let Ok(mut runtime) = hook_runtime.lock() {
                runtime.installed = false;
                runtime
                    .last_error
                    .get_or_insert_with(|| "hidden-window event hook thread exited".to_string());
            }
            record_app_runtime_event("hidden-window", "hook-thread-exited", None);
        })
        .ok();
}

pub(super) fn shutdown_hidden_window_event_hooks() {
    let Some(runtime) = HIDDEN_WINDOW_HOOK_RUNTIME.get() else {
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

fn install_hidden_window_event_hooks() -> Result<Vec<HWINEVENTHOOK>> {
    Ok(vec![
        install_hidden_window_event_hook(EVENT_OBJECT_SHOW)?,
        install_hidden_window_event_hook(EVENT_OBJECT_HIDE)?,
        install_hidden_window_event_hook(EVENT_OBJECT_LOCATIONCHANGE)?,
        install_hidden_window_event_hook(EVENT_SYSTEM_FOREGROUND)?,
        install_hidden_window_event_hook(EVENT_SYSTEM_MINIMIZESTART)?,
        install_hidden_window_event_hook(EVENT_SYSTEM_MINIMIZEEND)?,
    ])
}

fn install_hidden_window_event_hook(event_code: u32) -> Result<HWINEVENTHOOK> {
    let hook = unsafe {
        SetWinEventHook(
            event_code,
            event_code,
            None,
            Some(hidden_window_event_proc),
            0,
            0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        )
    };

    if hook.0.is_null() {
        anyhow::bail!(
            "SetWinEventHook failed for event {}",
            hidden_window_event_name(event_code)
        );
    }

    Ok(hook)
}

unsafe extern "system" fn hidden_window_event_proc(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    id_object: i32,
    id_child: i32,
    event_thread_id: u32,
    _event_time_ms: u32,
) {
    if hwnd.0.is_null() || !should_capture_hidden_window_event(event, id_object, id_child) {
        return;
    }

    let hwnd_value = hwnd.0 as usize as u64;
    let owner_process_id = hidden_window_registry()
        .lock()
        .ok()
        .and_then(|tracked_values| {
            tracked_values
                .get(&hwnd_value)
                .map(|record| record.owner_process_id)
        });

    let Some(owner_process_id) = owner_process_id else {
        return;
    };

    if !window_owner_matches(hwnd_value, owner_process_id) {
        record_hidden_window_lifecycle_event(
            hwnd_value,
            "hook-drop-owner-mismatch",
            Some(format!("expectedProcessId={owner_process_id}")),
        );
        if let Ok(mut tracked_values) = hidden_window_registry().lock() {
            tracked_values.remove(&hwnd_value);
        }
        return;
    }

    let now_ms = current_epoch_ms();
    let observation = observe_hidden_window(hwnd_value);
    let currently_visible = observation.map(|value| value.visible).unwrap_or(false);
    let currently_on_screen = observation
        .map(|value| value.visible && value.on_screen)
        .unwrap_or(false);
    let rehide_requested = observation
        .map(|value| value.visible || !value.tool_window)
        .unwrap_or(false);
    let currently_tool_window = observation.map(|value| value.tool_window).unwrap_or(false);
    let hook_event = HiddenWindowHookEvent {
        recorded_at_ms: now_ms,
        hwnd: hwnd_value,
        event_code: event,
        event_name: hidden_window_event_name(event).to_string(),
        id_object,
        id_child,
        event_thread_id,
        currently_visible,
        currently_on_screen,
        currently_tool_window,
        rehide_requested,
    };

    let mut tracked = false;

    if let Ok(mut tracked_values) = hidden_window_registry().lock() {
        if let Some(record) = tracked_values.get_mut(&hwnd_value) {
            push_hidden_window_hook_event(
                &mut record.hook_events,
                hook_event.clone(),
                MAX_HOOK_EVENTS_PER_WINDOW,
            );

            if rehide_requested {
                record.last_force_hide_at_ms = Some(now_ms);
            }

            tracked = true;
        }
    }

    if !tracked {
        return;
    }

    if let Ok(mut runtime) = hidden_window_hook_runtime().lock() {
        push_hidden_window_hook_event(
            &mut runtime.recent_events,
            hook_event,
            MAX_RECENT_HOOK_EVENTS,
        );
    }

    if rehide_requested {
        record_hidden_window_lifecycle_event(
            hwnd_value,
            "hook-rehide",
            Some(hidden_window_event_name(event).to_string()),
        );
        let _ = set_window_tool_window_mode(hwnd_value, true);
        let _ = hide_window_now(hwnd_value);
    }
}

fn should_capture_hidden_window_event(event: u32, id_object: i32, id_child: i32) -> bool {
    match event {
        EVENT_OBJECT_SHOW | EVENT_OBJECT_HIDE | EVENT_OBJECT_LOCATIONCHANGE => {
            id_object == 0 && id_child == 0
        }
        EVENT_SYSTEM_FOREGROUND | EVENT_SYSTEM_MINIMIZESTART | EVENT_SYSTEM_MINIMIZEEND => {
            id_child == 0
        }
        _ => false,
    }
}

fn hidden_window_event_name(event: u32) -> &'static str {
    match event {
        EVENT_OBJECT_SHOW => "EVENT_OBJECT_SHOW",
        EVENT_OBJECT_HIDE => "EVENT_OBJECT_HIDE",
        EVENT_OBJECT_LOCATIONCHANGE => "EVENT_OBJECT_LOCATIONCHANGE",
        EVENT_SYSTEM_FOREGROUND => "EVENT_SYSTEM_FOREGROUND",
        EVENT_SYSTEM_MINIMIZESTART => "EVENT_SYSTEM_MINIMIZESTART",
        EVENT_SYSTEM_MINIMIZEEND => "EVENT_SYSTEM_MINIMIZEEND",
        _ => "UNKNOWN",
    }
}
