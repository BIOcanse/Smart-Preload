use crate::{
    ForegroundPageRecord, PageKeywordEntry, TrackingState,
    db::{record_foreground_page, record_link_behavior, upsert_page_keywords},
    model::WeightedKeyword,
};

#[allow(clippy::too_many_arguments)]
pub(crate) fn record_foreground_page_event(
    state: &mut TrackingState,
    tab_id: String,
    window_id: String,
    node_id: String,
    page_url: String,
    title: String,
    text_digest: String,
    content_fingerprint: String,
    occurred_at: String,
    activated_at: Option<String>,
    left_foreground_at: Option<String>,
    was_preloaded_before_foreground: bool,
) {
    record_foreground_page(
        &mut state.graph,
        ForegroundPageRecord {
            tab_id: tab_id.parse::<i32>().unwrap_or(-1),
            window_id: window_id.parse::<i32>().unwrap_or(-1),
            node_id,
            page_url,
            title,
            text_digest,
            content_fingerprint,
            activated_at: activated_at.or_else(|| Some(occurred_at.clone())),
            left_foreground_at,
            was_preloaded_before_foreground,
        },
    );
    state.graph.updated_at = Some(occurred_at);
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn upsert_page_keywords_event(
    state: &mut TrackingState,
    page_url: String,
    site_node_id: String,
    title: String,
    keywords: Vec<WeightedKeyword>,
    page_type: Option<String>,
    generated_at: Option<String>,
    expires_at: Option<String>,
    model_id: String,
    content_fingerprint: String,
) {
    let generated_at = generated_at.unwrap_or_default();
    upsert_page_keywords(
        &mut state.graph,
        PageKeywordEntry {
            page_url,
            site_node_id,
            title,
            keywords,
            page_type,
            generated_at: if generated_at.is_empty() {
                None
            } else {
                Some(generated_at.clone())
            },
            expires_at,
            model_id,
            content_fingerprint,
        },
    );
    state.graph.updated_at = if generated_at.is_empty() {
        state.graph.updated_at.clone()
    } else {
        Some(generated_at)
    };
}

pub(crate) fn record_link_behavior_event(
    state: &mut TrackingState,
    source_page_url: String,
    target_url: String,
    target_hint: String,
    occurred_at: String,
) {
    record_link_behavior(
        &mut state.graph,
        source_page_url,
        target_url,
        target_hint,
        occurred_at.clone(),
    );
    state.graph.updated_at = Some(occurred_at);
}
