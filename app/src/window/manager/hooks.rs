use super::monitor::observe_hidden_window;
use super::registry::{
    current_epoch_ms, hidden_window_hook_runtime, hidden_window_registry,
    push_hidden_window_hook_event, record_hidden_window_lifecycle_event,
    MAX_HOOK_EVENTS_PER_WINDOW, MAX_RECENT_HOOK_EVENTS,
};
use super::*;
use crate::window::actions::set_window_tool_window_mode;
use std::sync::{Arc, OnceLock};
use std::thread;

static HIDDEN_WINDOW_HOOK_STARTED: OnceLock<()> = OnceLock::new();

pub(super) fn ensure_hidden_window_event_hooks() {
    let hook_runtime = hidden_window_hook_runtime();

    HIDDEN_WINDOW_HOOK_STARTED.get_or_init(|| {
        record_app_runtime_event("hidden-window", "hook-thread-started", None);
        let hook_runtime = Arc::clone(&hook_runtime);

        thread::spawn(move || {
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

            loop {
                let result = unsafe { GetMessageW(&mut message, HWND::default(), 0, 0) };
                let status = result.0;

                if status == -1 {
                    let error =
                        "GetMessageW failed for hidden-window event hook thread".to_string();
                    record_app_runtime_event(
                        "hidden-window",
                        "hook-thread-message-loop-failed",
                        Some(error.clone()),
                    );
                    if let Ok(mut runtime) = hook_runtime.lock() {
                        runtime.installed = false;
                        runtime.last_error = Some(error.clone());
                    }
                    tracing::error!(%error);
                    break;
                }

                if status == 0 {
                    break;
                }

                unsafe {
                    let _ = TranslateMessage(&message);
                    DispatchMessageW(&message);
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
        });
    });
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
