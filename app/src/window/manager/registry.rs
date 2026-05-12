use super::*;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static HIDDEN_WINDOW_REGISTRY: OnceLock<Arc<Mutex<HashMap<u64, HiddenWindowMonitorRecord>>>> =
    OnceLock::new();
static HIDDEN_WINDOW_HOOK_RUNTIME: OnceLock<Arc<Mutex<HiddenWindowHookRuntime>>> = OnceLock::new();

pub(super) const HIDDEN_WINDOW_MONITOR_INTERVAL_MS: u64 = 100;
pub(super) const MAX_VISIBILITY_EPISODES_PER_WINDOW: usize = 64;
pub(super) const MAX_HOOK_EVENTS_PER_WINDOW: usize = 64;
pub(super) const MAX_RECENT_HOOK_EVENTS: usize = 256;
pub(super) const MAX_LIFECYCLE_EVENTS_PER_WINDOW: usize = 64;
pub(super) const MAX_RECENT_LIFECYCLE_EVENTS: usize = 256;

#[derive(Debug, Clone)]
pub(super) struct HiddenWindowMonitorRecord {
    pub(super) hwnd: u64,
    pub(super) tracked_since_ms: u64,
    pub(super) first_hide_requested_at_ms: Option<u64>,
    pub(super) last_hide_requested_at_ms: Option<u64>,
    pub(super) hide_request_count: u64,
    pub(super) first_hide_match_visible: bool,
    pub(super) first_hide_match_on_screen: bool,
    pub(super) first_hide_match_tool_window: bool,
    pub(super) currently_visible: bool,
    pub(super) currently_on_screen: bool,
    pub(super) currently_tool_window: bool,
    pub(super) was_visible_since_tracked: bool,
    pub(super) was_on_screen_since_tracked: bool,
    pub(super) was_tool_window_missing_since_tracked: bool,
    pub(super) visible_observation_count: u64,
    pub(super) on_screen_observation_count: u64,
    pub(super) tool_window_missing_observation_count: u64,
    pub(super) estimated_visible_duration_ms: u64,
    pub(super) estimated_on_screen_duration_ms: u64,
    pub(super) estimated_tool_window_missing_duration_ms: u64,
    pub(super) last_observed_at_ms: Option<u64>,
    pub(super) last_seen_visible_at_ms: Option<u64>,
    pub(super) last_seen_on_screen_at_ms: Option<u64>,
    pub(super) last_seen_tool_window_missing_at_ms: Option<u64>,
    pub(super) last_force_hide_at_ms: Option<u64>,
    pub(super) visibility_episodes: VecDeque<HiddenWindowVisibilityEpisode>,
    pub(super) hook_events: VecDeque<HiddenWindowHookEvent>,
    pub(super) lifecycle_events: VecDeque<HiddenWindowLifecycleEvent>,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct HiddenWindowObservation {
    pub(super) visible: bool,
    pub(super) on_screen: bool,
    pub(super) tool_window: bool,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct HiddenWindowHideMatchObservation {
    pub(super) visible: bool,
    pub(super) on_screen: bool,
    pub(super) tool_window: bool,
}

#[derive(Debug, Default)]
pub(super) struct HiddenWindowHookRuntime {
    pub(super) installed: bool,
    pub(super) last_error: Option<String>,
    pub(super) recent_events: VecDeque<HiddenWindowHookEvent>,
    pub(super) recent_lifecycle_events: VecDeque<HiddenWindowLifecycleEvent>,
}

pub(super) fn hidden_window_registry() -> Arc<Mutex<HashMap<u64, HiddenWindowMonitorRecord>>> {
    HIDDEN_WINDOW_REGISTRY
        .get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
        .clone()
}

pub(super) fn hidden_window_hook_runtime() -> Arc<Mutex<HiddenWindowHookRuntime>> {
    HIDDEN_WINDOW_HOOK_RUNTIME
        .get_or_init(|| Arc::new(Mutex::new(HiddenWindowHookRuntime::default())))
        .clone()
}

pub(super) fn track_hidden_window(
    hwnd: u64,
    hide_match_observation: HiddenWindowHideMatchObservation,
) {
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

pub(super) fn untrack_hidden_window(hwnd: u64) {
    record_hidden_window_lifecycle_event(hwnd, "untrack", None);

    if let Ok(mut tracked_values) = hidden_window_registry().lock() {
        tracked_values.remove(&hwnd);
    }
}

pub(super) fn tracked_hidden_window_hwnds() -> Vec<u64> {
    hidden_window_registry()
        .lock()
        .map(|tracked_values| tracked_values.keys().copied().collect())
        .unwrap_or_default()
}

pub(super) fn is_tracked_hidden_window(hwnd: u64) -> bool {
    hidden_window_registry()
        .lock()
        .map(|tracked_values| tracked_values.contains_key(&hwnd))
        .unwrap_or(false)
}

pub(super) fn update_hidden_window_record(
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

pub(super) fn record_hidden_window_lifecycle_event(
    hwnd: u64,
    event_name: &str,
    detail: Option<String>,
) {
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

pub(super) fn push_hidden_window_hook_event(
    target: &mut VecDeque<HiddenWindowHookEvent>,
    hook_event: HiddenWindowHookEvent,
    max_events: usize,
) {
    target.push_back(hook_event);

    while target.len() > max_events {
        target.pop_front();
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

pub(super) fn current_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
