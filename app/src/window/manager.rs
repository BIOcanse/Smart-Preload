use super::actions::{hide_window_now, set_window_tool_window_mode, show_window_now};
use super::enumerate::find_chrome_window;
use super::*;
use crate::runtime_debug::{record_app_runtime_event, snapshot_app_runtime_events};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

static HIDDEN_WINDOW_REGISTRY: OnceLock<Arc<Mutex<HashMap<u64, HiddenWindowMonitorRecord>>>> =
    OnceLock::new();
static HIDDEN_WINDOW_HOOK_RUNTIME: OnceLock<Arc<Mutex<HiddenWindowHookRuntime>>> = OnceLock::new();
static HIDDEN_WINDOW_MONITOR_STARTED: OnceLock<()> = OnceLock::new();
static HIDDEN_WINDOW_HOOK_STARTED: OnceLock<()> = OnceLock::new();

const HIDDEN_WINDOW_MONITOR_INTERVAL_MS: u64 = 100;
const MAX_VISIBILITY_EPISODES_PER_WINDOW: usize = 64;
const MAX_HOOK_EVENTS_PER_WINDOW: usize = 64;
const MAX_RECENT_HOOK_EVENTS: usize = 256;
const MAX_LIFECYCLE_EVENTS_PER_WINDOW: usize = 64;
const MAX_RECENT_LIFECYCLE_EVENTS: usize = 256;

#[derive(Debug, Clone)]
struct HiddenWindowMonitorRecord {
    hwnd: u64,
    tracked_since_ms: u64,
    first_hide_requested_at_ms: Option<u64>,
    last_hide_requested_at_ms: Option<u64>,
    hide_request_count: u64,
    first_hide_match_visible: bool,
    first_hide_match_on_screen: bool,
    first_hide_match_tool_window: bool,
    currently_visible: bool,
    currently_on_screen: bool,
    currently_tool_window: bool,
    was_visible_since_tracked: bool,
    was_on_screen_since_tracked: bool,
    was_tool_window_missing_since_tracked: bool,
    visible_observation_count: u64,
    on_screen_observation_count: u64,
    tool_window_missing_observation_count: u64,
    estimated_visible_duration_ms: u64,
    estimated_on_screen_duration_ms: u64,
    estimated_tool_window_missing_duration_ms: u64,
    last_observed_at_ms: Option<u64>,
    last_seen_visible_at_ms: Option<u64>,
    last_seen_on_screen_at_ms: Option<u64>,
    last_seen_tool_window_missing_at_ms: Option<u64>,
    last_force_hide_at_ms: Option<u64>,
    visibility_episodes: VecDeque<HiddenWindowVisibilityEpisode>,
    hook_events: VecDeque<HiddenWindowHookEvent>,
    lifecycle_events: VecDeque<HiddenWindowLifecycleEvent>,
}

#[derive(Debug, Clone, Copy)]
struct HiddenWindowObservation {
    visible: bool,
    on_screen: bool,
    tool_window: bool,
}

#[derive(Debug, Clone, Copy)]
struct HiddenWindowHideMatchObservation {
    visible: bool,
    on_screen: bool,
    tool_window: bool,
}

#[derive(Debug, Default)]
struct HiddenWindowHookRuntime {
    installed: bool,
    last_error: Option<String>,
    recent_events: VecDeque<HiddenWindowHookEvent>,
    recent_lifecycle_events: VecDeque<HiddenWindowLifecycleEvent>,
}

// This file is the explicit WindowManager boundary. Ongoing hidden-window
// policy and monitoring belong here; lower Win32 actions stay in actions.rs.

fn hidden_window_registry() -> Arc<Mutex<HashMap<u64, HiddenWindowMonitorRecord>>> {
    HIDDEN_WINDOW_REGISTRY
        .get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
        .clone()
}

fn hidden_window_hook_runtime() -> Arc<Mutex<HiddenWindowHookRuntime>> {
    HIDDEN_WINDOW_HOOK_RUNTIME
        .get_or_init(|| Arc::new(Mutex::new(HiddenWindowHookRuntime::default())))
        .clone()
}

fn ensure_hidden_window_monitor() {
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

fn ensure_hidden_window_event_hooks() {
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

fn track_hidden_window(hwnd: u64, hide_match_observation: HiddenWindowHideMatchObservation) {
    ensure_hidden_window_monitor();
    ensure_hidden_window_event_hooks();
    let mut inserted_new_record = false;
    let now_ms = current_epoch_ms();

    if let Ok(mut tracked_values) = hidden_window_registry().lock() {
        tracked_values
            .entry(hwnd)
            .and_modify(|record| {
                if record.first_hide_requested_at_ms.is_none() {
                    record.first_hide_requested_at_ms = Some(now_ms);
                }
                record.last_hide_requested_at_ms = Some(now_ms);
                record.hide_request_count += 1;
                record.last_force_hide_at_ms = Some(now_ms);
            })
            .or_insert_with(|| {
                inserted_new_record = true;
                HiddenWindowMonitorRecord {
                    hwnd,
                    tracked_since_ms: now_ms,
                    first_hide_requested_at_ms: Some(now_ms),
                    last_hide_requested_at_ms: Some(now_ms),
                    hide_request_count: 1,
                    first_hide_match_visible: hide_match_observation.visible,
                    first_hide_match_on_screen: hide_match_observation.on_screen,
                    first_hide_match_tool_window: hide_match_observation.tool_window,
                    currently_visible: false,
                    currently_on_screen: false,
                    currently_tool_window: true,
                    was_visible_since_tracked: false,
                    was_on_screen_since_tracked: false,
                    was_tool_window_missing_since_tracked: false,
                    visible_observation_count: 0,
                    on_screen_observation_count: 0,
                    tool_window_missing_observation_count: 0,
                    estimated_visible_duration_ms: 0,
                    estimated_on_screen_duration_ms: 0,
                    estimated_tool_window_missing_duration_ms: 0,
                    last_observed_at_ms: None,
                    last_seen_visible_at_ms: None,
                    last_seen_on_screen_at_ms: None,
                    last_seen_tool_window_missing_at_ms: None,
                    last_force_hide_at_ms: Some(now_ms),
                    visibility_episodes: VecDeque::new(),
                    hook_events: VecDeque::new(),
                    lifecycle_events: VecDeque::new(),
                }
            });
    }

    if inserted_new_record {
        record_hidden_window_lifecycle_event(hwnd, "track", None);
    }
}

fn untrack_hidden_window(hwnd: u64) {
    record_hidden_window_lifecycle_event(hwnd, "untrack", None);

    if let Ok(mut tracked_values) = hidden_window_registry().lock() {
        tracked_values.remove(&hwnd);
    }
}

fn observe_hidden_window(hwnd: u64) -> Option<HiddenWindowObservation> {
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

fn rect_intersects_virtual_screen(rect: RECT) -> bool {
    let virtual_left = unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) };
    let virtual_top = unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) };
    let virtual_right = virtual_left + unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) };
    let virtual_bottom = virtual_top + unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) };

    rect.right > virtual_left
        && rect.left < virtual_right
        && rect.bottom > virtual_top
        && rect.top < virtual_bottom
}

fn update_hidden_window_record(
    record: &mut HiddenWindowMonitorRecord,
    observation: HiddenWindowObservation,
    now_ms: u64,
) {
    let was_visible = record.currently_visible;

    record.currently_visible = observation.visible;
    record.currently_on_screen = observation.visible && observation.on_screen;
    record.currently_tool_window = observation.tool_window;
    record.last_observed_at_ms = Some(now_ms);

    if observation.visible {
        record.was_visible_since_tracked = true;
        record.visible_observation_count += 1;
        record.estimated_visible_duration_ms += HIDDEN_WINDOW_MONITOR_INTERVAL_MS;
        record.last_seen_visible_at_ms = Some(now_ms);

        if observation.on_screen {
            record.was_on_screen_since_tracked = true;
            record.on_screen_observation_count += 1;
            record.estimated_on_screen_duration_ms += HIDDEN_WINDOW_MONITOR_INTERVAL_MS;
            record.last_seen_on_screen_at_ms = Some(now_ms);
        }

        if !was_visible || record.visibility_episodes.back().is_none() {
            record
                .visibility_episodes
                .push_back(HiddenWindowVisibilityEpisode {
                    visible_started_at_ms: now_ms,
                    visible_ended_at_ms: None,
                    sample_count: 1,
                    estimated_visible_duration_ms: HIDDEN_WINDOW_MONITOR_INTERVAL_MS,
                    observed_on_screen: observation.on_screen,
                    last_observed_at_ms: now_ms,
                });
        } else if let Some(active_episode) = record.visibility_episodes.back_mut() {
            active_episode.sample_count += 1;
            active_episode.estimated_visible_duration_ms += HIDDEN_WINDOW_MONITOR_INTERVAL_MS;
            active_episode.observed_on_screen |= observation.on_screen;
            active_episode.last_observed_at_ms = now_ms;
        }
    } else if was_visible {
        if let Some(active_episode) = record.visibility_episodes.back_mut() {
            if active_episode.visible_ended_at_ms.is_none() {
                active_episode.visible_ended_at_ms = Some(now_ms);
                active_episode.last_observed_at_ms = now_ms;
            }
        }
    }

    if !observation.tool_window {
        record.was_tool_window_missing_since_tracked = true;
        record.tool_window_missing_observation_count += 1;
        record.estimated_tool_window_missing_duration_ms += HIDDEN_WINDOW_MONITOR_INTERVAL_MS;
        record.last_seen_tool_window_missing_at_ms = Some(now_ms);
    }

    while record.visibility_episodes.len() > MAX_VISIBILITY_EPISODES_PER_WINDOW {
        record.visibility_episodes.pop_front();
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

fn push_hidden_window_hook_event(
    target: &mut VecDeque<HiddenWindowHookEvent>,
    hook_event: HiddenWindowHookEvent,
    max_events: usize,
) {
    target.push_back(hook_event);

    while target.len() > max_events {
        target.pop_front();
    }
}

fn record_hidden_window_lifecycle_event(hwnd: u64, event_name: &str, detail: Option<String>) {
    let lifecycle_event = HiddenWindowLifecycleEvent {
        recorded_at_ms: current_epoch_ms(),
        hwnd,
        event_name: event_name.to_string(),
        detail,
    };

    if let Ok(mut tracked_values) = hidden_window_registry().lock() {
        if let Some(record) = tracked_values.get_mut(&hwnd) {
            push_hidden_window_lifecycle_event(
                &mut record.lifecycle_events,
                lifecycle_event.clone(),
                MAX_LIFECYCLE_EVENTS_PER_WINDOW,
            );
        }
    }

    if let Ok(mut runtime) = hidden_window_hook_runtime().lock() {
        push_hidden_window_lifecycle_event(
            &mut runtime.recent_lifecycle_events,
            lifecycle_event,
            MAX_RECENT_LIFECYCLE_EVENTS,
        );
    }
}

fn push_hidden_window_lifecycle_event(
    target: &mut VecDeque<HiddenWindowLifecycleEvent>,
    lifecycle_event: HiddenWindowLifecycleEvent,
    max_events: usize,
) {
    target.push_back(lifecycle_event);

    while target.len() > max_events {
        target.pop_front();
    }
}

fn current_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

pub(super) fn hidden_window_monitor_snapshot() -> HiddenWindowMonitorSnapshot {
    let (hook_installed, hook_last_error, recent_hook_events, recent_lifecycle_events) =
        hidden_window_hook_runtime()
            .lock()
            .map(|runtime| {
                (
                    runtime.installed,
                    runtime.last_error.clone(),
                    runtime.recent_events.iter().cloned().collect::<Vec<_>>(),
                    runtime
                        .recent_lifecycle_events
                        .iter()
                        .cloned()
                        .collect::<Vec<_>>(),
                )
            })
            .unwrap_or((
                false,
                Some("hidden-window hook runtime lock poisoned".to_string()),
                vec![],
                vec![],
            ));

    let tracked_windows = hidden_window_registry()
        .lock()
        .map(|tracked_values| {
            tracked_values
                .values()
                .cloned()
                .map(|record| HiddenWindowMonitorInfo {
                    hwnd: record.hwnd,
                    tracked_since_ms: record.tracked_since_ms,
                    first_hide_requested_at_ms: record.first_hide_requested_at_ms,
                    last_hide_requested_at_ms: record.last_hide_requested_at_ms,
                    hide_request_count: record.hide_request_count,
                    first_hide_match_visible: record.first_hide_match_visible,
                    first_hide_match_on_screen: record.first_hide_match_on_screen,
                    first_hide_match_tool_window: record.first_hide_match_tool_window,
                    currently_visible: record.currently_visible,
                    currently_on_screen: record.currently_on_screen,
                    currently_tool_window: record.currently_tool_window,
                    was_visible_since_tracked: record.was_visible_since_tracked,
                    was_on_screen_since_tracked: record.was_on_screen_since_tracked,
                    was_tool_window_missing_since_tracked: record
                        .was_tool_window_missing_since_tracked,
                    visible_observation_count: record.visible_observation_count,
                    on_screen_observation_count: record.on_screen_observation_count,
                    tool_window_missing_observation_count: record
                        .tool_window_missing_observation_count,
                    estimated_visible_duration_ms: record.estimated_visible_duration_ms,
                    estimated_on_screen_duration_ms: record.estimated_on_screen_duration_ms,
                    estimated_tool_window_missing_duration_ms: record
                        .estimated_tool_window_missing_duration_ms,
                    last_observed_at_ms: record.last_observed_at_ms,
                    last_seen_visible_at_ms: record.last_seen_visible_at_ms,
                    last_seen_on_screen_at_ms: record.last_seen_on_screen_at_ms,
                    last_seen_tool_window_missing_at_ms: record.last_seen_tool_window_missing_at_ms,
                    last_force_hide_at_ms: record.last_force_hide_at_ms,
                    visibility_episodes: record.visibility_episodes.into_iter().collect(),
                    hook_events: record.hook_events.into_iter().collect(),
                    lifecycle_events: record.lifecycle_events.into_iter().collect(),
                })
                .collect::<Vec<HiddenWindowMonitorInfo>>()
        })
        .unwrap_or_default();

    HiddenWindowMonitorSnapshot {
        generated_at_ms: current_epoch_ms(),
        monitor_interval_ms: HIDDEN_WINDOW_MONITOR_INTERVAL_MS,
        hook_installed,
        hook_last_error,
        recent_runtime_events: snapshot_app_runtime_events(256),
        recent_hook_events,
        recent_lifecycle_events,
        tracked_windows,
    }
}

pub(super) fn hide_chrome_window(request: &HideWindowRequest) -> HideWindowResponse {
    match find_chrome_window(request) {
        Some(window) => match hide_window_now(window.hwnd) {
            Ok(()) => {
                let pre_hide_observation = HiddenWindowHideMatchObservation {
                    visible: window.visible,
                    on_screen: window.visible
                        && rect_intersects_virtual_screen(RECT {
                            left: window.left,
                            top: window.top,
                            right: window.left + window.width,
                            bottom: window.top + window.height,
                        }),
                    tool_window: window.tool_window,
                };
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
