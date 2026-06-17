mod current_page;
mod learning;
mod tabs;
mod transitions;

use crate::{EngineEvent, TrackingState};

pub(crate) fn apply_event(state: &mut TrackingState, event: EngineEvent) {
    match event {
        EngineEvent::SetCurrentPage {
            tab_id,
            target_node,
            occurred_at,
            url,
        } => current_page::set_current_page(state, tab_id, target_node, occurred_at, url),
        EngineEvent::RecordVisit {
            tab_id,
            target_node,
            occurred_at,
            event_type,
            transition_type,
            url,
        } => transitions::record_visit(
            state,
            tab_id,
            target_node,
            occurred_at,
            event_type,
            transition_type,
            url,
        ),
        EngineEvent::RecordForegroundPage {
            tab_id,
            window_id,
            node_id,
            page_url,
            title,
            text_digest,
            content_fingerprint,
            occurred_at,
            activated_at,
            left_foreground_at,
            was_preloaded_before_foreground,
        } => learning::record_foreground_page_event(
            state,
            tab_id,
            window_id,
            node_id,
            page_url,
            title,
            text_digest,
            content_fingerprint,
            occurred_at,
            activated_at,
            left_foreground_at,
            was_preloaded_before_foreground,
        ),
        EngineEvent::UpsertPageKeywords {
            page_url,
            site_node_id,
            title,
            keywords,
            page_type,
            generated_at,
            expires_at,
            model_id,
            content_fingerprint,
        } => learning::upsert_page_keywords_event(
            state,
            page_url,
            site_node_id,
            title,
            keywords,
            page_type,
            generated_at,
            expires_at,
            model_id,
            content_fingerprint,
        ),
        EngineEvent::RecordLinkBehavior {
            source_page_url,
            target_url,
            target_hint,
            occurred_at,
        } => learning::record_link_behavior_event(
            state,
            source_page_url,
            target_url,
            target_hint,
            occurred_at,
        ),
        EngineEvent::RecordCreatedNavigationTarget {
            source_tab_id,
            target_tab_id,
            occurred_at,
        } => {
            tabs::record_created_navigation_target(state, source_tab_id, target_tab_id, occurred_at)
        }
        EngineEvent::RecordTabReplacement {
            replaced_tab_id,
            new_tab_id,
        } => tabs::record_tab_replacement(state, replaced_tab_id, new_tab_id),
        EngineEvent::RemoveTab { tab_id } => tabs::remove_tab(state, tab_id),
    }
}
