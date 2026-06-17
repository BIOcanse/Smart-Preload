mod buckets;
mod learning;
mod normalize;

use std::collections::BTreeMap;

use crate::{
    Edge, Graph, Node, NodeSeed, PageKeywordEntry, PageTransitionBuckets,
    PageTransitionMessageBuckets, TransitionBuckets, TransitionMessage, TransitionMessageBuckets,
    TransitionStats,
    model::{
        ForegroundPageRecord, LinkBehaviorRecord, PageKeywordBuckets, PageTransitionBucket,
        PageTransitionBucketLayer, PageTransitionMessageBucket, WeightedKeyword,
    },
};

use self::normalize::recalculate_edge_transition_stats;

const STARTUP_SYNC_MESSAGE_WINDOW: usize = 10;
const BUCKET_PRIMARY_CHARSET: &str = "abcdefghijklmnopqrstuvwxyz0123456789_";
const BUCKET_SECONDARY_BLANK_INDEX: usize = BUCKET_PRIMARY_CHARSET.len();
const OUTBOUND_BUCKET_COUNT: usize =
    BUCKET_PRIMARY_CHARSET.len() * (BUCKET_PRIMARY_CHARSET.len() + 1);
const MAX_RECENT_FOREGROUND_PAGES: usize = 6;
const MAX_HISTORY_PAGE_POOL_SIZE: usize = 5;

pub(crate) use self::buckets::{
    build_day_key, create_empty_bucket_layer, create_empty_message_bucket_layer,
    create_empty_page_bucket_layer, create_empty_page_message_bucket_layer,
    external_page_transition_bucket_day_layer_mut, get_external_page_transition_count,
    get_intra_site_page_transition_count, get_transition_count, get_transition_source_map,
    intra_site_page_transition_bucket_day_layer_mut, set_transition_bucket_count,
    set_transition_bucket_count_delta, source_bucket_index, transition_bucket_day_layer_mut,
};
pub(crate) use self::learning::{
    record_foreground_page, record_link_behavior, upsert_page_keywords,
};
pub(crate) use self::normalize::normalize_graph;

pub(crate) fn upsert_node(graph: &mut Graph, target_node: &NodeSeed, occurred_at: &str) {
    if let Some(node) = graph.nodes.get_mut(&target_node.node_id) {
        node.last_seen_at = occurred_at.to_owned();
        node.sample_url = target_node.sample_url.clone();
        if node.default_landing_page_url.is_empty() {
            node.default_landing_page_url = target_node.sample_url.clone();
        }
        return;
    }

    graph.nodes.insert(
        target_node.node_id.clone(),
        Node {
            node_id: target_node.node_id.clone(),
            origin: target_node.origin.clone(),
            host: target_node.host.clone(),
            hostname: target_node.hostname.clone(),
            protocol: target_node.protocol.clone(),
            sample_url: target_node.sample_url.clone(),
            default_landing_page_url: target_node.sample_url.clone(),
            visit_count: 0,
            first_seen_at: occurred_at.to_owned(),
            last_seen_at: occurred_at.to_owned(),
        },
    );
}

pub(crate) fn upsert_edge(
    graph: &mut Graph,
    from_node_id: &str,
    to_node_id: &str,
    occurred_at: &str,
    transition_type: &str,
) {
    let edge_id = format!("{from_node_id} -> {to_node_id}");

    if !graph.edges.contains_key(&edge_id) {
        graph.edges.insert(
            edge_id.clone(),
            Edge {
                edge_id: edge_id.clone(),
                from_node_id: from_node_id.to_owned(),
                to_node_id: to_node_id.to_owned(),
                from_host: buckets::node_host(graph, from_node_id),
                to_host: buckets::node_host(graph, to_node_id),
                count: 0,
                transition_stats: TransitionStats::default(),
                daily_counts: BTreeMap::new(),
                first_seen_at: occurred_at.to_owned(),
                last_seen_at: occurred_at.to_owned(),
                last_transition_type: transition_type.to_owned(),
            },
        );
    }

    if let Some(edge) = graph.edges.get_mut(&edge_id) {
        edge.count += 1;
        edge.last_seen_at = occurred_at.to_owned();
        edge.last_transition_type = transition_type.to_owned();
        let day_key = build_day_key(occurred_at);
        *edge.daily_counts.entry(day_key).or_insert(0) += 1;
        recalculate_edge_transition_stats(edge, occurred_at);
    }
}

pub(crate) fn create_transition_message(
    graph: &Graph,
    sequence_number: u64,
    tab_id: &str,
    previous_node_id: Option<&str>,
    previous_page_url: Option<&str>,
    target_node: &NodeSeed,
    occurred_at: &str,
    event_type: &str,
    transition_type: &str,
    url: &str,
) -> TransitionMessage {
    TransitionMessage {
        sequence_number,
        from_node_id: previous_node_id.map(|value| value.to_owned()),
        to_node_id: target_node.node_id.clone(),
        from_host: previous_node_id.map(|node_id| buckets::node_host(graph, node_id)),
        to_host: target_node.host.clone(),
        from_page_url: previous_page_url.map(|value| value.to_owned()),
        to_page_url: url.to_owned(),
        tab_id: tab_id.parse::<i32>().unwrap_or(-1),
        occurred_at: occurred_at.to_owned(),
        event_type: event_type.to_owned(),
        transition_type: transition_type.to_owned(),
        url: url.to_owned(),
    }
}

pub(crate) fn append_transition_message(graph: &mut Graph, transition_message: TransitionMessage) {
    graph.transition_messages.push(transition_message);
}

pub(crate) fn apply_transition_message_to_indexes(
    graph: &mut Graph,
    transition_message: &TransitionMessage,
) {
    replay_transition_message_into_edge_counts(graph, transition_message);
    register_transition_message_in_day_groups(graph, transition_message);
    register_transition_message_in_buckets(
        graph,
        transition_message.from_node_id.as_deref(),
        &transition_message.to_node_id,
        transition_message.sequence_number,
    );
    register_transition_message_in_page_indexes(graph, transition_message);
}

fn register_transition_message_in_day_groups(
    graph: &mut Graph,
    transition_message: &TransitionMessage,
) {
    if transition_message.sequence_number == 0 {
        return;
    }

    let day_key = build_day_key(&transition_message.occurred_at);
    let day_messages = graph.transition_messages_by_day.entry(day_key).or_default();

    if day_messages.last().copied() != Some(transition_message.sequence_number) {
        day_messages.push(transition_message.sequence_number);
    }
}

fn register_edge_in_transition_buckets(
    graph: &mut Graph,
    edge_id: &str,
    from_node_id: &str,
    to_node_id: &str,
) {
    if from_node_id == to_node_id {
        return;
    }

    let Some(edge) = graph.edges.get(edge_id) else {
        return;
    };
    let bucket_index = source_bucket_index(graph, from_node_id);

    set_transition_bucket_count(
        &mut graph.transition_buckets.total,
        bucket_index,
        from_node_id,
        to_node_id,
        edge.count,
    );
}

fn replay_transition_message_into_edge_counts(
    graph: &mut Graph,
    transition_message: &TransitionMessage,
) {
    let Some(from_node_id) = transition_message.from_node_id.as_deref() else {
        return;
    };

    upsert_edge(
        graph,
        from_node_id,
        &transition_message.to_node_id,
        &transition_message.occurred_at,
        &transition_message.transition_type,
    );
}

fn register_transition_message_in_buckets(
    graph: &mut Graph,
    from_node_id: Option<&str>,
    to_node_id: &str,
    sequence_number: u64,
) {
    let Some(from_node_id) = from_node_id else {
        return;
    };

    if to_node_id.is_empty() || sequence_number == 0 {
        return;
    }

    let bucket_index = source_bucket_index(graph, from_node_id);
    let Some(bucket) = graph
        .transition_message_buckets
        .buckets
        .get_mut(bucket_index)
    else {
        return;
    };
    let source_map = bucket.entry(from_node_id.to_owned()).or_default();
    let target_messages = source_map.entry(to_node_id.to_owned()).or_default();

    if target_messages.last().copied() != Some(sequence_number) {
        target_messages.push(sequence_number);
    }
}

fn register_transition_message_in_page_indexes(
    graph: &mut Graph,
    transition_message: &TransitionMessage,
) {
    register_transition_count_buckets(graph, transition_message);
    register_page_transition_count_buckets(graph, transition_message);
    register_page_transition_message_buckets(graph, transition_message);
}

fn register_transition_count_buckets(graph: &mut Graph, transition_message: &TransitionMessage) {
    let Some(from_node_id) = transition_message.from_node_id.as_deref() else {
        return;
    };

    if transition_message.to_node_id.is_empty() || from_node_id == transition_message.to_node_id {
        return;
    }

    let bucket_index = source_bucket_index(graph, from_node_id);
    set_transition_bucket_count_delta(
        &mut graph.transition_buckets.total,
        bucket_index,
        from_node_id,
        &transition_message.to_node_id,
        1,
    );

    let day_key = build_day_key(&transition_message.occurred_at);
    let bucket_layer = transition_bucket_day_layer_mut(graph, &day_key);
    set_transition_bucket_count_delta(
        bucket_layer,
        bucket_index,
        from_node_id,
        &transition_message.to_node_id,
        1,
    );
}

fn register_page_transition_count_buckets(
    graph: &mut Graph,
    transition_message: &TransitionMessage,
) {
    let Some(from_node_id) = transition_message.from_node_id.as_deref() else {
        return;
    };
    let Some(from_page_url) = transition_message.from_page_url.as_deref() else {
        return;
    };

    if transition_message.to_node_id.is_empty() || transition_message.to_page_url.is_empty() {
        return;
    }

    let day_key = build_day_key(&transition_message.occurred_at);
    let bucket_index = source_bucket_index(graph, from_node_id);

    if from_node_id == transition_message.to_node_id {
        buckets::increment_page_transition_bucket_count(
            &mut graph.intra_site_page_transition_buckets.total,
            bucket_index,
            from_node_id,
            from_page_url,
            &transition_message.to_node_id,
            &transition_message.to_page_url,
            1,
        );

        let bucket_layer = intra_site_page_transition_bucket_day_layer_mut(graph, &day_key);
        buckets::increment_page_transition_bucket_count(
            bucket_layer,
            bucket_index,
            from_node_id,
            from_page_url,
            &transition_message.to_node_id,
            &transition_message.to_page_url,
            1,
        );
        return;
    }

    buckets::increment_page_transition_bucket_count(
        &mut graph.external_page_transition_buckets.total,
        bucket_index,
        from_node_id,
        from_page_url,
        &transition_message.to_node_id,
        &transition_message.to_page_url,
        1,
    );

    let bucket_layer = external_page_transition_bucket_day_layer_mut(graph, &day_key);
    buckets::increment_page_transition_bucket_count(
        bucket_layer,
        bucket_index,
        from_node_id,
        from_page_url,
        &transition_message.to_node_id,
        &transition_message.to_page_url,
        1,
    );
}

fn register_page_transition_message_buckets(
    graph: &mut Graph,
    transition_message: &TransitionMessage,
) {
    let Some(from_node_id) = transition_message.from_node_id.as_deref() else {
        return;
    };
    let Some(from_page_url) = transition_message.from_page_url.as_deref() else {
        return;
    };

    if transition_message.to_node_id.is_empty()
        || transition_message.to_page_url.is_empty()
        || transition_message.sequence_number == 0
    {
        return;
    }

    let bucket_index = source_bucket_index(graph, from_node_id);
    let Some(bucket) = graph
        .page_transition_message_buckets
        .buckets
        .get_mut(bucket_index)
    else {
        return;
    };
    let source_site_map = bucket.entry(from_node_id.to_owned()).or_default();
    let source_page_map = source_site_map.entry(from_page_url.to_owned()).or_default();
    let target_site_map = source_page_map
        .entry(transition_message.to_node_id.clone())
        .or_default();
    let target_messages = target_site_map
        .entry(transition_message.to_page_url.clone())
        .or_default();

    if target_messages.last().copied() != Some(transition_message.sequence_number) {
        target_messages.push(transition_message.sequence_number);
    }
}
