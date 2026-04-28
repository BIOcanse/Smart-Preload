use super::*;

pub(crate) fn get_page_transition_count(
    graph: &Graph,
    window_key: &str,
    source_node_id: &str,
    source_page_url: &str,
    target_node_id: &str,
    target_page_url: &str,
) -> u64 {
    if window_key == "total" {
        let bucket_index = source_bucket_index(graph, source_node_id);
        let Some(bucket) = graph.page_transition_buckets.total.get(bucket_index) else {
            return 0;
        };
        let Some(source_site_map) = bucket.get(source_node_id) else {
            return 0;
        };
        let Some(source_page_map) = source_site_map.get(source_page_url) else {
            return 0;
        };
        let Some(target_site_map) = source_page_map.get(target_node_id) else {
            return 0;
        };

        return target_site_map.get(target_page_url).copied().unwrap_or(0);
    }

    sum_page_transition_counts_for_window(
        graph,
        window_key,
        source_node_id,
        source_page_url,
        target_node_id,
        target_page_url,
    )
}

pub(crate) fn increment_page_transition_bucket_count(
    bucket_layer: &mut PageTransitionBucketLayer,
    bucket_index: usize,
    source_node_id: &str,
    source_page_url: &str,
    target_node_id: &str,
    target_page_url: &str,
    delta: u64,
) {
    if bucket_layer.len() != OUTBOUND_BUCKET_COUNT {
        *bucket_layer = create_empty_page_bucket_layer();
    }

    let bucket = &mut bucket_layer[bucket_index];
    let source_site_map = bucket.entry(source_node_id.to_owned()).or_default();
    let source_page_map = source_site_map
        .entry(source_page_url.to_owned())
        .or_default();
    let target_site_map = source_page_map
        .entry(target_node_id.to_owned())
        .or_default();
    let target_count = target_site_map
        .entry(target_page_url.to_owned())
        .or_insert(0);
    *target_count += delta;
}

pub(crate) fn page_transition_bucket_day_layer_mut<'a>(
    graph: &'a mut Graph,
    day_key: &str,
) -> &'a mut PageTransitionBucketLayer {
    graph
        .page_transition_buckets
        .by_day
        .entry(day_key.to_owned())
        .or_insert_with(create_empty_page_bucket_layer)
}

fn sum_page_transition_counts_for_window(
    graph: &Graph,
    window_key: &str,
    source_node_id: &str,
    source_page_url: &str,
    target_node_id: &str,
    target_page_url: &str,
) -> u64 {
    let bucket_index = source_bucket_index(graph, source_node_id);
    let mut total = 0;

    for day_key in matching_day_keys_for_window(graph, window_key) {
        let Some(bucket_layer) = graph.page_transition_buckets.by_day.get(&day_key) else {
            continue;
        };
        let Some(bucket) = bucket_layer.get(bucket_index) else {
            continue;
        };
        let Some(source_site_map) = bucket.get(source_node_id) else {
            continue;
        };
        let Some(source_page_map) = source_site_map.get(source_page_url) else {
            continue;
        };
        let Some(target_site_map) = source_page_map.get(target_node_id) else {
            continue;
        };

        total += target_site_map.get(target_page_url).copied().unwrap_or(0);
    }

    total
}
