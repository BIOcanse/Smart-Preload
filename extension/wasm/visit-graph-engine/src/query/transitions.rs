use serde_json::{Value, json};

pub(crate) fn query_transition_bucket(
    graph: &crate::Graph,
    window_key: Option<String>,
    source_node_id: &str,
) -> Value {
    let normalized_window_key = super::normalize_transition_window_key(window_key.as_deref());

    if source_node_id.is_empty() {
        return json!({
            "windowKey": normalized_window_key,
            "sourceNodeId": source_node_id,
            "bucketIndex": Value::Null,
            "targets": [],
        });
    }

    let bucket_index = crate::db::source_bucket_index(graph, source_node_id);
    let targets =
        crate::db::get_transition_source_map(graph, normalized_window_key, source_node_id)
            .iter()
            .map(|(target_node_id, count)| {
                json!({
                    "targetNodeId": target_node_id,
                    "count": count,
                })
            })
            .collect::<Vec<Value>>();

    json!({
        "windowKey": normalized_window_key,
        "sourceNodeId": source_node_id,
        "bucketIndex": bucket_index,
        "targets": targets,
    })
}

pub(crate) fn query_transition_message_bucket(
    graph: &crate::Graph,
    source_node_id: &str,
    target_node_id: Option<&str>,
) -> Value {
    if source_node_id.is_empty() {
        return json!({
            "sourceNodeId": source_node_id,
            "targetNodeId": target_node_id,
            "bucketIndex": Value::Null,
            "targets": [],
            "sequenceNumbers": [],
        });
    }

    let bucket_index = crate::db::source_bucket_index(graph, source_node_id);
    let source_map = graph
        .transition_message_buckets
        .buckets
        .get(bucket_index)
        .and_then(|bucket| bucket.get(source_node_id));

    if let Some(target_node_id) = target_node_id {
        let sequence_numbers = source_map
            .and_then(|bucket_targets| bucket_targets.get(target_node_id))
            .cloned()
            .unwrap_or_default();

        return json!({
            "sourceNodeId": source_node_id,
            "targetNodeId": target_node_id,
            "bucketIndex": bucket_index,
            "sequenceNumbers": sequence_numbers,
        });
    }

    let targets = source_map
        .map(|bucket_targets| {
            bucket_targets
                .iter()
                .map(|(next_target_node_id, sequence_numbers)| {
                    json!({
                        "targetNodeId": next_target_node_id,
                        "sequenceNumbers": sequence_numbers,
                    })
                })
                .collect::<Vec<Value>>()
        })
        .unwrap_or_default();

    json!({
        "sourceNodeId": source_node_id,
        "targetNodeId": Value::Null,
        "bucketIndex": bucket_index,
        "targets": targets,
    })
}

pub(crate) fn query_transition_message(graph: &crate::Graph, sequence_number: u64) -> Value {
    if sequence_number == 0 {
        return Value::Null;
    }

    graph
        .transition_messages
        .iter()
        .find(|transition_message| transition_message.sequence_number == sequence_number)
        .and_then(|transition_message| serde_json::to_value(transition_message).ok())
        .unwrap_or(Value::Null)
}

pub(crate) fn query_recent_transition_messages(graph: &crate::Graph, limit: usize) -> Value {
    let normalized_limit = limit.max(1);
    let start_index = graph
        .transition_messages
        .len()
        .saturating_sub(normalized_limit);
    let recent_messages = graph.transition_messages[start_index..]
        .iter()
        .cloned()
        .collect::<Vec<crate::TransitionMessage>>();

    serde_json::to_value(recent_messages).unwrap_or_else(|_| Value::Array(Vec::new()))
}

pub(crate) fn query_candidate_transition_metrics_batch(
    graph: &crate::Graph,
    window_key: Option<String>,
    source_node_id: &str,
    source_page_url: &str,
    candidates: Vec<crate::model::CandidateTransitionMetricQuery>,
) -> Value {
    let normalized_window_key = super::normalize_transition_window_key(window_key.as_deref());

    json!({
        "windowKey": normalized_window_key,
        "sourceNodeId": source_node_id,
        "sourcePageUrl": source_page_url,
        "candidates": candidates.into_iter().map(|candidate| {
            let is_same_origin_candidate =
                page_transition_is_same_origin(source_page_url, &candidate.target_page_url);
            let is_same_site_candidate =
                !source_node_id.is_empty() && source_node_id == candidate.target_node_id;
            let site_transition_count = if source_node_id.is_empty()
                || candidate.target_node_id.is_empty()
                || is_same_site_candidate
            {
                0
            } else {
                crate::db::get_transition_count(
                    graph,
                    normalized_window_key,
                    source_node_id,
                    &candidate.target_node_id,
                )
            };
            let outbound_page_transition_count = if source_node_id.is_empty()
                || source_page_url.is_empty()
                || candidate.target_node_id.is_empty()
                || candidate.target_page_url.is_empty()
                || is_same_site_candidate
            {
                0
            } else {
                crate::db::get_external_page_transition_count(
                    graph,
                    normalized_window_key,
                    source_node_id,
                    source_page_url,
                    &candidate.target_node_id,
                    &candidate.target_page_url,
                )
            };
            let intra_site_page_transition_count = if source_node_id.is_empty()
                || source_page_url.is_empty()
                || candidate.target_node_id.is_empty()
                || candidate.target_page_url.is_empty()
                || !is_same_site_candidate
            {
                0
            } else {
                crate::db::get_intra_site_page_transition_count(
                    graph,
                    normalized_window_key,
                    source_node_id,
                    source_page_url,
                    &candidate.target_node_id,
                    &candidate.target_page_url,
                )
            };
            let page_transition_count = if is_same_site_candidate {
                intra_site_page_transition_count
            } else {
                outbound_page_transition_count
            };

            json!({
                "url": candidate.url,
                "targetNodeId": candidate.target_node_id,
                "targetPageUrl": candidate.target_page_url,
                "isSameOriginCandidate": is_same_origin_candidate,
                "isSameSiteCandidate": is_same_site_candidate,
                "siteTransitionCount": site_transition_count,
                "pageTransitionCount": page_transition_count,
                "outboundPageTransitionCount": outbound_page_transition_count,
                "intraSitePageTransitionCount": intra_site_page_transition_count,
                "transitionCount": if is_same_site_candidate {
                    intra_site_page_transition_count
                } else {
                    outbound_page_transition_count
                },
            })
        }).collect::<Vec<Value>>(),
    })
}

fn page_transition_is_same_origin(source_page_url: &str, target_page_url: &str) -> bool {
    extract_origin(source_page_url)
        .zip(extract_origin(target_page_url))
        .map(|(source_origin, target_origin)| source_origin == target_origin)
        .unwrap_or(false)
}

fn extract_origin(page_url: &str) -> Option<&str> {
    let scheme_separator_index = page_url.find("://")?;
    let authority_start = scheme_separator_index + 3;
    let path_start = page_url[authority_start..]
        .find('/')
        .map(|offset| authority_start + offset)
        .unwrap_or(page_url.len());
    Some(&page_url[..path_start])
}
