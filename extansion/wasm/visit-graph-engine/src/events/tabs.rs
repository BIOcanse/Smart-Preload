use crate::{PendingSource, TrackingState};

pub(crate) fn record_created_navigation_target(
    state: &mut TrackingState,
    source_tab_id: String,
    target_tab_id: String,
    occurred_at: String,
) {
    let Some(source_node_id) = state
        .tab_state
        .get(&source_tab_id)
        .map(|entry| entry.node_id.clone())
    else {
        return;
    };

    state.pending_sources.insert(
        target_tab_id,
        PendingSource {
            node_id: source_node_id,
            page_url: state
                .tab_state
                .get(&source_tab_id)
                .map(|entry| entry.url.clone()),
            created_at: occurred_at,
        },
    );
}

pub(crate) fn record_tab_replacement(
    state: &mut TrackingState,
    replaced_tab_id: String,
    new_tab_id: String,
) {
    if let Some(tab_state) = state.tab_state.remove(&replaced_tab_id) {
        state.tab_state.insert(new_tab_id.clone(), tab_state);
    }

    if let Some(pending_source) = state.pending_sources.remove(&replaced_tab_id) {
        state.pending_sources.insert(new_tab_id, pending_source);
    }
}

pub(crate) fn remove_tab(state: &mut TrackingState, tab_id: String) {
    state.tab_state.remove(&tab_id);
    state.pending_sources.remove(&tab_id);
}
