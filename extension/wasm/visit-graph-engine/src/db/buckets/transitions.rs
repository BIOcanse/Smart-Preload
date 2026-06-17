use super::*;

pub(crate) fn get_transition_source_map(
    graph: &Graph,
    window_key: &str,
    source_node_id: &str,
) -> BTreeMap<String, u64> {
    let bucket_index = source_bucket_index(graph, source_node_id);

    if window_key == "total" {
        return graph
            .transition_buckets
            .total
            .get(bucket_index)
            .and_then(|bucket| bucket.get(source_node_id))
            .cloned()
            .unwrap_or_default();
    }

    let mut aggregated_source_map = BTreeMap::new();

    for day_key in matching_day_keys_for_window(graph, window_key) {
        let Some(bucket_layer) = graph.transition_buckets.by_day.get(&day_key) else {
            continue;
        };
        let Some(bucket) = bucket_layer.get(bucket_index) else {
            continue;
        };
        let Some(source_map) = bucket.get(source_node_id) else {
            continue;
        };

        for (target_node_id, count) in source_map {
            *aggregated_source_map
                .entry(target_node_id.clone())
                .or_insert(0) += *count;
        }
    }

    aggregated_source_map
}

pub(crate) fn get_transition_count(
    graph: &Graph,
    window_key: &str,
    source_node_id: &str,
    target_node_id: &str,
) -> u64 {
    get_transition_source_map(graph, window_key, source_node_id)
        .get(target_node_id)
        .copied()
        .unwrap_or(0)
}

pub(crate) fn set_transition_bucket_count(
    bucket_layer: &mut Vec<BTreeMap<String, BTreeMap<String, u64>>>,
    bucket_index: usize,
    from_node_id: &str,
    to_node_id: &str,
    count: u64,
) {
    if bucket_layer.len() != OUTBOUND_BUCKET_COUNT {
        *bucket_layer = create_empty_bucket_layer();
    }

    let bucket = &mut bucket_layer[bucket_index];
    let source_map = bucket.entry(from_node_id.to_owned()).or_default();

    if count > 0 {
        source_map.insert(to_node_id.to_owned(), count);
        return;
    }

    source_map.remove(to_node_id);
    if source_map.is_empty() {
        bucket.remove(from_node_id);
    }
}

pub(crate) fn set_transition_bucket_count_delta(
    bucket_layer: &mut Vec<BTreeMap<String, BTreeMap<String, u64>>>,
    bucket_index: usize,
    from_node_id: &str,
    to_node_id: &str,
    delta: u64,
) {
    if delta == 0 {
        return;
    }

    if bucket_layer.len() != OUTBOUND_BUCKET_COUNT {
        *bucket_layer = create_empty_bucket_layer();
    }

    let bucket = &mut bucket_layer[bucket_index];
    let source_map = bucket.entry(from_node_id.to_owned()).or_default();
    let next_count = source_map
        .get(to_node_id)
        .copied()
        .unwrap_or(0)
        .saturating_add(delta);
    source_map.insert(to_node_id.to_owned(), next_count);
}
