mod learning;
mod transitions;

use serde_json::Value;

pub(crate) fn execute_query(
    graph: &crate::Graph,
    query: crate::EngineQuery,
) -> Result<Value, String> {
    match query {
        crate::EngineQuery::GetTransitionBucket {
            window_key,
            source_node_id,
        } => Ok(transitions::query_transition_bucket(
            graph,
            window_key,
            &source_node_id,
        )),
        crate::EngineQuery::GetTransitionMessageBucket {
            source_node_id,
            target_node_id,
        } => Ok(transitions::query_transition_message_bucket(
            graph,
            &source_node_id,
            target_node_id.as_deref(),
        )),
        crate::EngineQuery::GetTransitionMessage { sequence_number } => Ok(
            transitions::query_transition_message(graph, sequence_number),
        ),
        crate::EngineQuery::GetRecentTransitionMessages { limit } => Ok(
            transitions::query_recent_transition_messages(graph, limit.unwrap_or(20)),
        ),
        crate::EngineQuery::GetCandidateTransitionMetricsBatch {
            window_key,
            source_node_id,
            source_page_url,
            candidates,
        } => Ok(transitions::query_candidate_transition_metrics_batch(
            graph,
            window_key,
            &source_node_id,
            &source_page_url,
            candidates,
        )),
        crate::EngineQuery::GetPageKeywords { page_url } => {
            Ok(learning::query_page_keywords(graph, &page_url))
        }
        crate::EngineQuery::GetPageKeywordsBatch { page_urls } => {
            Ok(learning::query_page_keywords_batch(graph, page_urls))
        }
        crate::EngineQuery::GetRecentForegroundPages { limit } => Ok(
            learning::query_recent_foreground_pages(graph, limit.unwrap_or(6)),
        ),
        crate::EngineQuery::GetHistoryPagePool { limit } => {
            Ok(learning::query_history_page_pool(graph, limit.unwrap_or(5)))
        }
    }
}

fn normalize_transition_window_key(window_key: Option<&str>) -> &'static str {
    match window_key {
        Some("last365d") => "last365d",
        Some("last30d") => "last30d",
        Some("last7d") => "last7d",
        Some("last1d") => "last1d",
        _ => "total",
    }
}
