use super::registry::{
    current_epoch_ms, hidden_window_hook_runtime, hidden_window_registry,
    HIDDEN_WINDOW_MONITOR_INTERVAL_MS,
};
use super::*;
use crate::runtime_debug::snapshot_app_runtime_events;

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
