use crate::{
    NodeSeed, TabStateEntry, TrackingState,
    db::{
        append_transition_message, apply_transition_message_to_indexes, create_transition_message,
        upsert_node,
    },
};

const PENDING_SOURCE_TTL_MS: i64 = 15_000;

pub(crate) fn record_visit(
    state: &mut TrackingState,
    tab_id: String,
    target_node: NodeSeed,
    occurred_at: String,
    event_type: String,
    transition_type: String,
    url: String,
) {
    let pending_source = consume_pending_source_for_visit(state, &tab_id, &occurred_at);
    let previous_node_id = pending_source
        .as_ref()
        .map(|entry| entry.node_id.clone())
        .or_else(|| {
            state
                .tab_state
                .get(&tab_id)
                .map(|entry| entry.node_id.clone())
        });
    let previous_page_url = pending_source
        .as_ref()
        .and_then(|entry| entry.page_url.clone())
        .or_else(|| state.tab_state.get(&tab_id).map(|entry| entry.url.clone()));
    let is_new_page_visit = previous_page_url.as_deref() != Some(url.as_str());
    let has_source_context = previous_node_id.is_some()
        || previous_page_url
            .as_deref()
            .map(|page_url| !page_url.is_empty())
            .unwrap_or(false);

    upsert_node(&mut state.graph, &target_node, &occurred_at);

    let is_new_node_visit = previous_node_id
        .as_ref()
        .map(|node_id| node_id != &target_node.node_id)
        .unwrap_or(true);
    let is_exact_self_transition = previous_node_id.as_deref()
        == Some(target_node.node_id.as_str())
        && previous_page_url.as_deref() == Some(url.as_str());
    let should_record_transition =
        has_source_context && (is_new_node_visit || is_new_page_visit) && !is_exact_self_transition;

    if is_new_node_visit {
        if let Some(node) = state.graph.nodes.get_mut(&target_node.node_id) {
            node.visit_count += 1;
        }
    }

    if should_record_transition {
        state.graph.transition_sequence += 1;
        let transition_message = create_transition_message(
            &state.graph,
            state.graph.transition_sequence,
            &tab_id,
            previous_node_id.as_deref(),
            previous_page_url.as_deref(),
            &target_node,
            &occurred_at,
            &event_type,
            &transition_type,
            &url,
        );
        append_transition_message(&mut state.graph, transition_message.clone());
        apply_transition_message_to_indexes(&mut state.graph, &transition_message);
    }

    state.graph.updated_at = Some(occurred_at.clone());
    state.tab_state.insert(
        tab_id.clone(),
        TabStateEntry {
            node_id: target_node.node_id,
            url,
            updated_at: occurred_at,
        },
    );
}

fn consume_pending_source_for_visit(
    state: &mut TrackingState,
    tab_id: &str,
    occurred_at: &str,
) -> Option<crate::PendingSource> {
    let pending_source = state.pending_sources.remove(tab_id)?;

    if pending_source_is_stale(&pending_source.created_at, occurred_at) {
        return None;
    }

    Some(pending_source)
}

fn pending_source_is_stale(created_at: &str, occurred_at: &str) -> bool {
    let Ok(created_at_time) = chrono::DateTime::parse_from_rfc3339(created_at) else {
        return true;
    };
    let Ok(occurred_at_time) = chrono::DateTime::parse_from_rfc3339(occurred_at) else {
        return true;
    };

    occurred_at_time.timestamp_millis() - created_at_time.timestamp_millis() > PENDING_SOURCE_TTL_MS
}
