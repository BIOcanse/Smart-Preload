use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterCandidateInput {
    pub score: f64,
    pub visibility_score: f64,
    pub link_index: usize,
    #[serde(default)]
    pub bookmark_rank: u64,
    #[serde(default)]
    pub google_bookmark_candidate: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterRuleCardStateInput {
    pub value_a: f64,
    pub operator_a: String,
    pub operator_b: String,
    pub value_c: f64,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterCandidatesInput {
    #[serde(default)]
    pub rule_items: BTreeMap<String, FilterRuleCardStateInput>,
    #[serde(default)]
    pub max_targets: Option<usize>,
    #[serde(default)]
    pub candidates: Vec<FilterCandidateInput>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterCandidatesResult {
    pub kept_indices: Vec<usize>,
    pub ordered_indices: Vec<usize>,
    pub selected_indices: Vec<usize>,
}
