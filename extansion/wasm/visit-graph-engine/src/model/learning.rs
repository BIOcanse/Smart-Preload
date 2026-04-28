use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PageKeywordBuckets {
    #[serde(default)]
    pub(crate) by_keyword: BTreeMap<String, BTreeMap<String, f64>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WeightedKeyword {
    pub(crate) text: String,
    pub(crate) score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PageKeywordEntry {
    pub(crate) page_url: String,
    pub(crate) site_node_id: String,
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) keywords: Vec<WeightedKeyword>,
    #[serde(default)]
    pub(crate) page_type: Option<String>,
    #[serde(default)]
    pub(crate) generated_at: Option<String>,
    #[serde(default)]
    pub(crate) expires_at: Option<String>,
    pub(crate) model_id: String,
    pub(crate) content_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ForegroundPageRecord {
    pub(crate) tab_id: i32,
    pub(crate) window_id: i32,
    pub(crate) node_id: String,
    pub(crate) page_url: String,
    pub(crate) title: String,
    pub(crate) text_digest: String,
    pub(crate) content_fingerprint: String,
    #[serde(default)]
    pub(crate) activated_at: Option<String>,
    #[serde(default)]
    pub(crate) left_foreground_at: Option<String>,
    #[serde(default)]
    pub(crate) was_preloaded_before_foreground: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LinkBehaviorRecord {
    #[serde(default)]
    pub(crate) self_count: u64,
    #[serde(default)]
    pub(crate) blank_count: u64,
    pub(crate) last_target_hint: String,
    #[serde(default)]
    pub(crate) last_seen_at: Option<String>,
}
