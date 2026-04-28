use super::*;

pub(crate) fn reconcile_recent_transition_index_coverage(
    graph: &mut Graph,
    stored_version: u32,
    stored_edge_snapshots: &BTreeMap<String, Option<String>>,
    stored_transition_message_buckets: &TransitionMessageBuckets,
) {
    if stored_version < 5 {
        return;
    }

    let recent_messages: Vec<TransitionMessage> = graph
        .transition_messages
        .iter()
        .rev()
        .take(STARTUP_SYNC_MESSAGE_WINDOW)
        .cloned()
        .collect();

    for transition_message in recent_messages.into_iter().rev() {
        if !should_replay_transition_message_from_startup_check(
            graph,
            stored_edge_snapshots,
            stored_transition_message_buckets,
            &transition_message,
        ) {
            continue;
        }

        replay_transition_message_into_edge_counts(graph, &transition_message);
    }
}

fn should_replay_transition_message_from_startup_check(
    graph: &Graph,
    stored_edge_snapshots: &BTreeMap<String, Option<String>>,
    stored_transition_message_buckets: &TransitionMessageBuckets,
    transition_message: &TransitionMessage,
) -> bool {
    let Some(from_node_id) = transition_message.from_node_id.as_deref() else {
        return false;
    };

    if transition_message.to_node_id.is_empty() {
        return false;
    }

    let edge_id = format!("{from_node_id} -> {}", transition_message.to_node_id);
    let Some(stored_last_seen_at) = stored_edge_snapshots.get(&edge_id) else {
        return true;
    };

    if has_stored_transition_message_reference(
        graph,
        stored_transition_message_buckets,
        transition_message,
    ) {
        return false;
    }

    occurred_after(
        &transition_message.occurred_at,
        stored_last_seen_at.as_deref(),
    )
}

fn has_stored_transition_message_reference(
    graph: &Graph,
    stored_transition_message_buckets: &TransitionMessageBuckets,
    transition_message: &TransitionMessage,
) -> bool {
    let Some(from_node_id) = transition_message.from_node_id.as_deref() else {
        return false;
    };

    let bucket_index = buckets::source_bucket_index(graph, from_node_id);
    let Some(bucket) = stored_transition_message_buckets.buckets.get(bucket_index) else {
        return false;
    };
    let Some(source_map) = bucket.get(from_node_id) else {
        return false;
    };
    let Some(target_messages) = source_map.get(&transition_message.to_node_id) else {
        return false;
    };

    target_messages.contains(&transition_message.sequence_number)
}

fn occurred_after(left_occurred_at: &str, right_occurred_at: Option<&str>) -> bool {
    let Some(right_occurred_at) = right_occurred_at else {
        return false;
    };

    left_occurred_at > right_occurred_at
}
