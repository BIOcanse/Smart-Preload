use serde_json::Value;

pub(crate) fn query_page_keywords(graph: &crate::Graph, page_url: &str) -> Value {
    graph
        .page_keyword_store
        .get(page_url)
        .and_then(|entry| serde_json::to_value(entry).ok())
        .unwrap_or(Value::Null)
}

pub(crate) fn query_page_keywords_batch(graph: &crate::Graph, page_urls: Vec<String>) -> Value {
    let mut result = serde_json::Map::new();

    for page_url in page_urls {
        if let Some(entry) = graph.page_keyword_store.get(&page_url) {
            if let Ok(entry_value) = serde_json::to_value(entry) {
                result.insert(page_url, entry_value);
            }
        }
    }

    Value::Object(result)
}

pub(crate) fn query_recent_foreground_pages(graph: &crate::Graph, limit: usize) -> Value {
    let normalized_limit = limit.max(1);
    let recent_pages = graph
        .recent_foreground_pages
        .iter()
        .take(normalized_limit)
        .cloned()
        .collect::<Vec<crate::model::ForegroundPageRecord>>();

    serde_json::to_value(recent_pages).unwrap_or_else(|_| Value::Array(Vec::new()))
}

pub(crate) fn query_history_page_pool(graph: &crate::Graph, limit: usize) -> Value {
    let normalized_limit = limit.max(1);
    serde_json::json!({
        "titles": graph.history_page_titles.iter().take(normalized_limit).cloned().collect::<Vec<String>>(),
        "urls": graph.history_page_urls.iter().take(normalized_limit).cloned().collect::<Vec<String>>(),
        "texts": graph.history_page_texts.iter().take(normalized_limit).cloned().collect::<Vec<String>>(),
    })
}
