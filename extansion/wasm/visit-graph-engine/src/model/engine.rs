use serde::{Deserialize, Serialize};

use super::{NodeSeed, WeightedKeyword};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum EngineEvent {
    SetCurrentPage {
        tab_id: String,
        target_node: NodeSeed,
        occurred_at: String,
        url: String,
    },
    RecordVisit {
        tab_id: String,
        target_node: NodeSeed,
        occurred_at: String,
        event_type: String,
        transition_type: String,
        url: String,
    },
    RecordForegroundPage {
        tab_id: String,
        window_id: String,
        node_id: String,
        page_url: String,
        title: String,
        text_digest: String,
        content_fingerprint: String,
        occurred_at: String,
        #[serde(default)]
        activated_at: Option<String>,
        #[serde(default)]
        left_foreground_at: Option<String>,
        #[serde(default)]
        was_preloaded_before_foreground: bool,
    },
    UpsertPageKeywords {
        page_url: String,
        site_node_id: String,
        title: String,
        #[serde(default)]
        keywords: Vec<WeightedKeyword>,
        #[serde(default)]
        page_type: Option<String>,
        #[serde(default)]
        generated_at: Option<String>,
        #[serde(default)]
        expires_at: Option<String>,
        model_id: String,
        content_fingerprint: String,
    },
    RecordLinkBehavior {
        source_page_url: String,
        target_url: String,
        target_hint: String,
        occurred_at: String,
    },
    RecordCreatedNavigationTarget {
        source_tab_id: String,
        target_tab_id: String,
        occurred_at: String,
    },
    RecordTabReplacement {
        replaced_tab_id: String,
        new_tab_id: String,
    },
    RemoveTab {
        tab_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum EngineQuery {
    GetTransitionBucket {
        #[serde(default)]
        window_key: Option<String>,
        source_node_id: String,
    },
    GetTransitionMessageBucket {
        source_node_id: String,
        #[serde(default)]
        target_node_id: Option<String>,
    },
    GetTransitionMessage {
        sequence_number: u64,
    },
    GetRecentTransitionMessages {
        #[serde(default)]
        limit: Option<usize>,
    },
    GetCandidateTransitionMetricsBatch {
        #[serde(default)]
        window_key: Option<String>,
        source_node_id: String,
        #[serde(default)]
        source_page_url: String,
        #[serde(default)]
        candidates: Vec<CandidateTransitionMetricQuery>,
    },
    GetPageKeywords {
        page_url: String,
    },
    GetPageKeywordsBatch {
        #[serde(default)]
        page_urls: Vec<String>,
    },
    GetRecentForegroundPages {
        #[serde(default)]
        limit: Option<usize>,
    },
    GetHistoryPagePool {
        #[serde(default)]
        limit: Option<usize>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CandidateTransitionMetricQuery {
    pub(crate) url: String,
    pub(crate) target_node_id: String,
    pub(crate) target_page_url: String,
}
