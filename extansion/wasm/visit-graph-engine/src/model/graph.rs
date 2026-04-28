use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use super::{ForegroundPageRecord, LinkBehaviorRecord, PageKeywordBuckets, PageKeywordEntry};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrackingState {
    #[serde(default)]
    pub(crate) graph: Graph,
    #[serde(default)]
    pub(crate) tab_state: BTreeMap<String, TabStateEntry>,
    #[serde(default)]
    pub(crate) pending_sources: BTreeMap<String, PendingSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Graph {
    pub(crate) version: u32,
    #[serde(default)]
    pub(crate) nodes: BTreeMap<String, Node>,
    #[serde(default)]
    pub(crate) edges: BTreeMap<String, Edge>,
    #[serde(default)]
    pub(crate) transition_buckets: TransitionBuckets,
    #[serde(default)]
    pub(crate) transition_message_buckets: TransitionMessageBuckets,
    #[serde(default)]
    pub(crate) page_transition_buckets: PageTransitionBuckets,
    #[serde(default)]
    pub(crate) page_transition_message_buckets: PageTransitionMessageBuckets,
    #[serde(default)]
    pub(crate) link_behavior_store: BTreeMap<String, BTreeMap<String, LinkBehaviorRecord>>,
    #[serde(default)]
    pub(crate) page_keyword_store: BTreeMap<String, PageKeywordEntry>,
    #[serde(default)]
    pub(crate) page_keyword_buckets: PageKeywordBuckets,
    #[serde(default)]
    pub(crate) recent_foreground_pages: Vec<ForegroundPageRecord>,
    #[serde(default)]
    pub(crate) history_page_titles: Vec<String>,
    #[serde(default)]
    pub(crate) history_page_urls: Vec<String>,
    #[serde(default)]
    pub(crate) history_page_texts: Vec<String>,
    #[serde(default)]
    pub(crate) transition_messages: Vec<TransitionMessage>,
    #[serde(default)]
    pub(crate) transition_messages_by_day: BTreeMap<String, Vec<u64>>,
    #[serde(default)]
    pub(crate) transition_sequence: u64,
    pub(crate) updated_at: Option<String>,
}

impl Default for Graph {
    fn default() -> Self {
        Self {
            version: 10,
            nodes: BTreeMap::new(),
            edges: BTreeMap::new(),
            transition_buckets: TransitionBuckets::default(),
            transition_message_buckets: TransitionMessageBuckets::default(),
            page_transition_buckets: PageTransitionBuckets::default(),
            page_transition_message_buckets: PageTransitionMessageBuckets::default(),
            link_behavior_store: BTreeMap::new(),
            page_keyword_store: BTreeMap::new(),
            page_keyword_buckets: PageKeywordBuckets::default(),
            recent_foreground_pages: Vec::new(),
            history_page_titles: Vec::new(),
            history_page_urls: Vec::new(),
            history_page_texts: Vec::new(),
            transition_messages: Vec::new(),
            transition_messages_by_day: BTreeMap::new(),
            transition_sequence: 0,
            updated_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Node {
    pub(crate) node_id: String,
    pub(crate) origin: String,
    pub(crate) host: String,
    pub(crate) hostname: String,
    pub(crate) protocol: String,
    pub(crate) sample_url: String,
    pub(crate) visit_count: u64,
    pub(crate) first_seen_at: String,
    pub(crate) last_seen_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Edge {
    pub(crate) edge_id: String,
    pub(crate) from_node_id: String,
    pub(crate) to_node_id: String,
    pub(crate) from_host: String,
    pub(crate) to_host: String,
    pub(crate) count: u64,
    #[serde(default)]
    pub(crate) transition_stats: TransitionStats,
    #[serde(default)]
    pub(crate) daily_counts: BTreeMap<String, u64>,
    pub(crate) first_seen_at: String,
    pub(crate) last_seen_at: String,
    pub(crate) last_transition_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TransitionStats {
    pub(crate) total: u64,
    pub(crate) last365d: u64,
    pub(crate) last30d: u64,
    pub(crate) last7d: u64,
    pub(crate) last1d: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TransitionBuckets {
    #[serde(default = "crate::db::create_empty_bucket_layer")]
    pub(crate) total: Vec<BTreeMap<String, BTreeMap<String, u64>>>,
    #[serde(default)]
    pub(crate) by_day: BTreeMap<String, Vec<BTreeMap<String, BTreeMap<String, u64>>>>,
}

impl Default for TransitionBuckets {
    fn default() -> Self {
        Self {
            total: crate::db::create_empty_bucket_layer(),
            by_day: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TransitionMessage {
    #[serde(default)]
    pub(crate) sequence_number: u64,
    pub(crate) from_node_id: Option<String>,
    pub(crate) to_node_id: String,
    pub(crate) from_host: Option<String>,
    pub(crate) to_host: String,
    #[serde(default)]
    pub(crate) from_page_url: Option<String>,
    #[serde(default)]
    pub(crate) to_page_url: String,
    pub(crate) tab_id: i32,
    pub(crate) occurred_at: String,
    pub(crate) event_type: String,
    pub(crate) transition_type: String,
    #[serde(default)]
    pub(crate) url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TransitionMessageBuckets {
    #[serde(default = "crate::db::create_empty_message_bucket_layer")]
    pub(crate) buckets: Vec<BTreeMap<String, BTreeMap<String, Vec<u64>>>>,
}

impl Default for TransitionMessageBuckets {
    fn default() -> Self {
        Self {
            buckets: crate::db::create_empty_message_bucket_layer(),
        }
    }
}

pub(crate) type PageTransitionTargetMap = BTreeMap<String, u64>;
pub(crate) type PageTransitionTargetSiteMap = BTreeMap<String, PageTransitionTargetMap>;
pub(crate) type PageTransitionSourcePageMap = BTreeMap<String, PageTransitionTargetSiteMap>;
pub(crate) type PageTransitionBucket = BTreeMap<String, PageTransitionSourcePageMap>;
pub(crate) type PageTransitionBucketLayer = Vec<PageTransitionBucket>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PageTransitionBuckets {
    #[serde(default = "crate::db::create_empty_page_bucket_layer")]
    pub(crate) total: PageTransitionBucketLayer,
    #[serde(default)]
    pub(crate) by_day: BTreeMap<String, PageTransitionBucketLayer>,
}

impl Default for PageTransitionBuckets {
    fn default() -> Self {
        Self {
            total: crate::db::create_empty_page_bucket_layer(),
            by_day: BTreeMap::new(),
        }
    }
}

pub(crate) type PageTransitionMessageSequenceMap = BTreeMap<String, Vec<u64>>;
pub(crate) type PageTransitionMessageTargetSiteMap =
    BTreeMap<String, PageTransitionMessageSequenceMap>;
pub(crate) type PageTransitionMessageSourcePageMap =
    BTreeMap<String, PageTransitionMessageTargetSiteMap>;
pub(crate) type PageTransitionMessageBucket = BTreeMap<String, PageTransitionMessageSourcePageMap>;
pub(crate) type PageTransitionMessageBucketLayer = Vec<PageTransitionMessageBucket>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PageTransitionMessageBuckets {
    #[serde(default = "crate::db::create_empty_page_message_bucket_layer")]
    pub(crate) buckets: PageTransitionMessageBucketLayer,
}

impl Default for PageTransitionMessageBuckets {
    fn default() -> Self {
        Self {
            buckets: crate::db::create_empty_page_message_bucket_layer(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TabStateEntry {
    pub(crate) node_id: String,
    pub(crate) url: String,
    pub(crate) updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingSource {
    pub(crate) node_id: String,
    #[serde(default)]
    pub(crate) page_url: Option<String>,
    pub(crate) created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NodeSeed {
    pub(crate) node_id: String,
    pub(crate) origin: String,
    pub(crate) host: String,
    pub(crate) hostname: String,
    pub(crate) protocol: String,
    pub(crate) sample_url: String,
}
