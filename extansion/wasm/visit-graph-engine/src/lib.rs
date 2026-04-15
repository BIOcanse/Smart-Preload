use serde::{Deserialize, Serialize};
use std::cell::Cell;
use std::collections::BTreeMap;
use std::mem;

const STARTUP_SYNC_MESSAGE_WINDOW: usize = 10;
const BUCKET_PRIMARY_CHARSET: &str = "abcdefghijklmnopqrstuvwxyz0123456789_";
const BUCKET_SECONDARY_BLANK_INDEX: usize = BUCKET_PRIMARY_CHARSET.len();
const OUTBOUND_BUCKET_COUNT: usize =
    BUCKET_PRIMARY_CHARSET.len() * (BUCKET_PRIMARY_CHARSET.len() + 1);

thread_local! {
    static LAST_RESULT_LEN: Cell<usize> = const { Cell::new(0) };
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct TrackingState {
    #[serde(default)]
    graph: Graph,
    #[serde(default)]
    tab_state: BTreeMap<String, TabStateEntry>,
    #[serde(default)]
    pending_sources: BTreeMap<String, PendingSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Graph {
    version: u32,
    #[serde(default)]
    nodes: BTreeMap<String, Node>,
    #[serde(default)]
    edges: BTreeMap<String, Edge>,
    #[serde(default)]
    transition_buckets: TransitionBuckets,
    #[serde(default)]
    transition_message_buckets: TransitionMessageBuckets,
    #[serde(default, alias = "recentTransitions")]
    transition_messages: Vec<TransitionMessage>,
    #[serde(default)]
    transition_sequence: u64,
    updated_at: Option<String>,
}

impl Default for Graph {
    fn default() -> Self {
        Self {
            version: 6,
            nodes: BTreeMap::new(),
            edges: BTreeMap::new(),
            transition_buckets: TransitionBuckets::default(),
            transition_message_buckets: TransitionMessageBuckets::default(),
            transition_messages: Vec::new(),
            transition_sequence: 0,
            updated_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Node {
    node_id: String,
    origin: String,
    host: String,
    hostname: String,
    protocol: String,
    sample_url: String,
    visit_count: u64,
    first_seen_at: String,
    last_seen_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Edge {
    edge_id: String,
    from_node_id: String,
    to_node_id: String,
    from_host: String,
    to_host: String,
    count: u64,
    #[serde(default)]
    transition_stats: TransitionStats,
    #[serde(default)]
    daily_counts: BTreeMap<String, u64>,
    first_seen_at: String,
    last_seen_at: String,
    last_transition_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct TransitionStats {
    total: u64,
    last365d: u64,
    last30d: u64,
    last7d: u64,
    last1d: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransitionBuckets {
    #[serde(default = "create_empty_bucket_layer")]
    total: Vec<BTreeMap<String, BTreeMap<String, u64>>>,
    #[serde(default = "create_empty_bucket_layer")]
    last365d: Vec<BTreeMap<String, BTreeMap<String, u64>>>,
    #[serde(default = "create_empty_bucket_layer")]
    last30d: Vec<BTreeMap<String, BTreeMap<String, u64>>>,
    #[serde(default = "create_empty_bucket_layer")]
    last7d: Vec<BTreeMap<String, BTreeMap<String, u64>>>,
    #[serde(default = "create_empty_bucket_layer")]
    last1d: Vec<BTreeMap<String, BTreeMap<String, u64>>>,
}

impl Default for TransitionBuckets {
    fn default() -> Self {
        Self {
            total: create_empty_bucket_layer(),
            last365d: create_empty_bucket_layer(),
            last30d: create_empty_bucket_layer(),
            last7d: create_empty_bucket_layer(),
            last1d: create_empty_bucket_layer(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransitionMessage {
    #[serde(default)]
    sequence_number: u64,
    from_node_id: Option<String>,
    to_node_id: String,
    from_host: Option<String>,
    to_host: String,
    #[serde(default)]
    from_page_url: Option<String>,
    #[serde(default)]
    to_page_url: String,
    tab_id: i32,
    occurred_at: String,
    event_type: String,
    transition_type: String,
    #[serde(default)]
    url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransitionMessageBuckets {
    #[serde(default = "create_empty_message_bucket_layer")]
    buckets: Vec<BTreeMap<String, BTreeMap<String, Vec<u64>>>>,
}

impl Default for TransitionMessageBuckets {
    fn default() -> Self {
        Self {
            buckets: create_empty_message_bucket_layer(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TabStateEntry {
    node_id: String,
    url: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingSource {
    node_id: String,
    #[serde(default)]
    page_url: Option<String>,
    created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NodeSeed {
    node_id: String,
    origin: String,
    host: String,
    hostname: String,
    protocol: String,
    sample_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", rename_all_fields = "camelCase")]
enum EngineEvent {
    RecordVisit {
        tab_id: String,
        target_node: NodeSeed,
        occurred_at: String,
        event_type: String,
        transition_type: String,
        url: String,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApplyEventResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    state: Option<TrackingState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    if len == 0 {
        return std::ptr::null_mut();
    }

    let mut buffer = Vec::<u8>::with_capacity(len);
    let ptr = buffer.as_mut_ptr();
    mem::forget(buffer);
    ptr
}

#[unsafe(no_mangle)]
pub extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }

    unsafe {
        drop(Vec::from_raw_parts(ptr, len, len));
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn last_result_len() -> usize {
    LAST_RESULT_LEN.with(Cell::get)
}

#[unsafe(no_mangle)]
pub extern "C" fn free_result(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }

    unsafe {
        let slice_ptr = std::ptr::slice_from_raw_parts_mut(ptr, len);
        drop(Box::from_raw(slice_ptr));
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn apply_event_json(
    state_ptr: *const u8,
    state_len: usize,
    event_ptr: *const u8,
    event_len: usize,
) -> *mut u8 {
    let response = match apply_event_json_inner(state_ptr, state_len, event_ptr, event_len) {
        Ok(state) => ApplyEventResponse {
            ok: true,
            state: Some(state),
            error: None,
        },
        Err(error) => ApplyEventResponse {
            ok: false,
            state: None,
            error: Some(error),
        },
    };

    store_result(serde_json::to_vec(&response).unwrap_or_else(|error| {
        format!(
            "{{\"ok\":false,\"error\":\"failed to serialize response: {}\"}}",
            error
        )
        .into_bytes()
    }))
}

fn apply_event_json_inner(
    state_ptr: *const u8,
    state_len: usize,
    event_ptr: *const u8,
    event_len: usize,
) -> Result<TrackingState, String> {
    let mut state = if state_len == 0 {
        TrackingState::default()
    } else {
        serde_json::from_slice::<TrackingState>(read_input(state_ptr, state_len)?)
            .map_err(|error| format!("failed to parse state JSON: {error}"))?
    };

    let event = serde_json::from_slice::<EngineEvent>(read_input(event_ptr, event_len)?)
        .map_err(|error| format!("failed to parse event JSON: {error}"))?;

    normalize_graph(&mut state.graph);
    apply_event(&mut state, event);
    Ok(state)
}

fn apply_event(state: &mut TrackingState, event: EngineEvent) {
    match event {
        EngineEvent::RecordVisit {
            tab_id,
            target_node,
            occurred_at,
            event_type,
            transition_type,
            url,
        } => record_visit(
            state,
            tab_id,
            target_node,
            occurred_at,
            event_type,
            transition_type,
            url,
        ),
        EngineEvent::RecordCreatedNavigationTarget {
            source_tab_id,
            target_tab_id,
            occurred_at,
        } => record_created_navigation_target(state, source_tab_id, target_tab_id, occurred_at),
        EngineEvent::RecordTabReplacement {
            replaced_tab_id,
            new_tab_id,
        } => record_tab_replacement(state, replaced_tab_id, new_tab_id),
        EngineEvent::RemoveTab { tab_id } => {
            state.tab_state.remove(&tab_id);
            state.pending_sources.remove(&tab_id);
        }
    }
}

fn record_visit(
    state: &mut TrackingState,
    tab_id: String,
    target_node: NodeSeed,
    occurred_at: String,
    event_type: String,
    transition_type: String,
    url: String,
) {
    let previous_node_id = state
        .pending_sources
        .get(&tab_id)
        .map(|entry| entry.node_id.clone())
        .or_else(|| state.tab_state.get(&tab_id).map(|entry| entry.node_id.clone()));
    let previous_page_url = state
        .pending_sources
        .get(&tab_id)
        .and_then(|entry| entry.page_url.clone())
        .or_else(|| state.tab_state.get(&tab_id).map(|entry| entry.url.clone()));

    upsert_node(&mut state.graph, &target_node, &occurred_at);

    let is_new_node_visit = previous_node_id
        .as_ref()
        .map(|node_id| node_id != &target_node.node_id)
        .unwrap_or(true);

    if is_new_node_visit {
        if let Some(node) = state.graph.nodes.get_mut(&target_node.node_id) {
            node.visit_count += 1;
        }

        state.graph.transition_sequence += 1;
        let transition_message = create_transition_message(
            &state.graph,
            state.graph.transition_sequence,
            &tab_id,
            previous_node_id.as_deref(),
            previous_page_url.as_deref(),
            &target_node,
            &occurred_at,
            &event_type,
            &transition_type,
            &url,
        );
        append_transition_message(&mut state.graph, transition_message.clone());
        apply_transition_message_to_indexes(&mut state.graph, &transition_message);
    }

    state.graph.updated_at = Some(occurred_at.clone());
    state.tab_state.insert(
        tab_id.clone(),
        TabStateEntry {
            node_id: target_node.node_id,
            url,
            updated_at: occurred_at,
        },
    );
    state.pending_sources.remove(&tab_id);
}

fn record_created_navigation_target(
    state: &mut TrackingState,
    source_tab_id: String,
    target_tab_id: String,
    occurred_at: String,
) {
    let Some(source_node_id) = state
        .tab_state
        .get(&source_tab_id)
        .map(|entry| entry.node_id.clone())
    else {
        return;
    };

    state.pending_sources.insert(
        target_tab_id,
        PendingSource {
            node_id: source_node_id,
            page_url: state.tab_state.get(&source_tab_id).map(|entry| entry.url.clone()),
            created_at: occurred_at,
        },
    );
}

fn record_tab_replacement(
    state: &mut TrackingState,
    replaced_tab_id: String,
    new_tab_id: String,
) {
    if let Some(tab_state) = state.tab_state.remove(&replaced_tab_id) {
        state.tab_state.insert(new_tab_id.clone(), tab_state);
    }

    if let Some(pending_source) = state.pending_sources.remove(&replaced_tab_id) {
        state.pending_sources.insert(new_tab_id, pending_source);
    }
}

fn upsert_node(graph: &mut Graph, target_node: &NodeSeed, occurred_at: &str) {
    if let Some(node) = graph.nodes.get_mut(&target_node.node_id) {
        node.last_seen_at = occurred_at.to_owned();
        node.sample_url = target_node.sample_url.clone();
        return;
    }

    graph.nodes.insert(
        target_node.node_id.clone(),
        Node {
            node_id: target_node.node_id.clone(),
            origin: target_node.origin.clone(),
            host: target_node.host.clone(),
            hostname: target_node.hostname.clone(),
            protocol: target_node.protocol.clone(),
            sample_url: target_node.sample_url.clone(),
            visit_count: 0,
            first_seen_at: occurred_at.to_owned(),
            last_seen_at: occurred_at.to_owned(),
        },
    );
}

fn upsert_edge(
    graph: &mut Graph,
    from_node_id: &str,
    to_node_id: &str,
    occurred_at: &str,
    transition_type: &str,
) {
    let edge_id = format!("{from_node_id} -> {to_node_id}");

    if !graph.edges.contains_key(&edge_id) {
        graph.edges.insert(
            edge_id.clone(),
            Edge {
                edge_id: edge_id.clone(),
                from_node_id: from_node_id.to_owned(),
                to_node_id: to_node_id.to_owned(),
                from_host: node_host(graph, from_node_id),
                to_host: node_host(graph, to_node_id),
                count: 0,
                transition_stats: TransitionStats::default(),
                daily_counts: BTreeMap::new(),
                first_seen_at: occurred_at.to_owned(),
                last_seen_at: occurred_at.to_owned(),
                last_transition_type: transition_type.to_owned(),
            },
        );
    }

    if let Some(edge) = graph.edges.get_mut(&edge_id) {
        edge.count += 1;
        edge.last_seen_at = occurred_at.to_owned();
        edge.last_transition_type = transition_type.to_owned();
        let day_key = build_day_key(occurred_at);
        *edge.daily_counts.entry(day_key).or_insert(0) += 1;
        recalculate_edge_transition_stats(edge, occurred_at);
    }

    register_edge_in_transition_buckets(graph, &edge_id, from_node_id, to_node_id);
}

fn create_empty_bucket_layer() -> Vec<BTreeMap<String, BTreeMap<String, u64>>> {
    vec![BTreeMap::new(); OUTBOUND_BUCKET_COUNT]
}

fn create_empty_message_bucket_layer() -> Vec<BTreeMap<String, BTreeMap<String, Vec<u64>>>> {
    vec![BTreeMap::new(); OUTBOUND_BUCKET_COUNT]
}

fn normalize_graph(graph: &mut Graph) {
    let stored_version = graph.version;
    let stored_edge_snapshots: BTreeMap<String, Option<String>> = graph
        .edges
        .iter()
        .map(|(edge_id, edge)| (edge_id.clone(), Some(edge.last_seen_at.clone())))
        .collect();
    let stored_transition_message_buckets = graph.transition_message_buckets.clone();

    graph.version = 6;

    let edge_ids: Vec<String> = graph.edges.keys().cloned().collect();

    for edge_id in edge_ids {
        let (from_host_fallback, to_host_fallback) = graph
            .edges
            .get(&edge_id)
            .map(|edge| {
                let mut parts = edge_id.splitn(2, " -> ");
                let from_node_id = if edge.from_node_id.is_empty() {
                    parts.next().unwrap_or_default().to_owned()
                } else {
                    edge.from_node_id.clone()
                };
                let to_node_id = if edge.to_node_id.is_empty() {
                    parts.next().unwrap_or_default().to_owned()
                } else {
                    edge.to_node_id.clone()
                };

                (node_host(graph, &from_node_id), node_host(graph, &to_node_id))
            })
            .unwrap_or_else(|| (String::new(), String::new()));

        if let Some(edge) = graph.edges.get_mut(&edge_id) {
            normalize_edge(&edge_id, edge, from_host_fallback, to_host_fallback);
        }
    }

    normalize_transition_messages(&mut graph.transition_messages);
    graph.transition_sequence = graph.transition_sequence.max(
        graph.transition_messages
            .iter()
            .map(|message| message.sequence_number)
            .max()
            .unwrap_or(0),
    );

    graph.transition_buckets = TransitionBuckets::default();
    graph.transition_message_buckets = TransitionMessageBuckets::default();

    let rebuilt_edges: Vec<(String, String, String)> = graph
        .edges
        .iter()
        .map(|(edge_id, edge)| {
            (
                edge_id.clone(),
                edge.from_node_id.clone(),
                edge.to_node_id.clone(),
            )
        })
        .collect();

    for (edge_id, from_node_id, to_node_id) in rebuilt_edges {
        register_edge_in_transition_buckets(graph, &edge_id, &from_node_id, &to_node_id);
    }

    reconcile_recent_transition_index_coverage(
        graph,
        stored_version,
        &stored_edge_snapshots,
        &stored_transition_message_buckets,
    );

    for transition_message in graph.transition_messages.clone() {
        register_transition_message_in_buckets(
            graph,
            transition_message.from_node_id.as_deref(),
            &transition_message.to_node_id,
            transition_message.sequence_number,
        );
    }
}

fn normalize_edge(
    edge_id: &str,
    edge: &mut Edge,
    from_host_fallback: String,
    to_host_fallback: String,
) {
    if edge.edge_id.is_empty() {
        edge.edge_id = edge_id.to_owned();
    }

    if edge.from_node_id.is_empty() || edge.to_node_id.is_empty() {
        let mut parts = edge_id.splitn(2, " -> ");
        if edge.from_node_id.is_empty() {
            edge.from_node_id = parts.next().unwrap_or_default().to_owned();
        }
        if edge.to_node_id.is_empty() {
            edge.to_node_id = parts.next().unwrap_or_default().to_owned();
        }
    }

    if edge.from_host.is_empty() {
        edge.from_host = from_host_fallback;
    }

    if edge.to_host.is_empty() {
        edge.to_host = to_host_fallback;
    }

    if edge.daily_counts.is_empty() && edge.count > 0 {
        edge.daily_counts
            .insert(build_day_key(&edge.last_seen_at), edge.count);
    }

    let reference_at = edge.last_seen_at.clone();
    recalculate_edge_transition_stats(edge, &reference_at);
}

fn recalculate_edge_transition_stats(edge: &mut Edge, reference_at: &str) {
    let reference_day = day_key_to_epoch_day(&build_day_key(reference_at)).unwrap_or(0);
    let mut next_daily_counts = BTreeMap::new();
    let mut next_stats = TransitionStats {
        total: edge.count,
        ..TransitionStats::default()
    };

    for (day_key, count) in edge.daily_counts.iter() {
        let Some(day_number) = day_key_to_epoch_day(day_key) else {
            continue;
        };

        let age_in_days = reference_day.saturating_sub(day_number);

        if age_in_days <= 364 {
            next_daily_counts.insert(day_key.clone(), *count);
            next_stats.last365d += *count;
        }

        if age_in_days <= 29 {
            next_stats.last30d += *count;
        }

        if age_in_days <= 6 {
            next_stats.last7d += *count;
        }

        if age_in_days == 0 {
            next_stats.last1d += *count;
        }
    }

    edge.daily_counts = next_daily_counts;
    edge.transition_stats = next_stats;
}

fn register_edge_in_transition_buckets(
    graph: &mut Graph,
    edge_id: &str,
    from_node_id: &str,
    to_node_id: &str,
) {
    let Some(edge) = graph.edges.get(edge_id) else {
        return;
    };
    let bucket_index = source_bucket_index(graph, from_node_id);

    set_transition_bucket_count(
        &mut graph.transition_buckets.total,
        bucket_index,
        from_node_id,
        to_node_id,
        edge.transition_stats.total,
    );
    set_transition_bucket_count(
        &mut graph.transition_buckets.last365d,
        bucket_index,
        from_node_id,
        to_node_id,
        edge.transition_stats.last365d,
    );
    set_transition_bucket_count(
        &mut graph.transition_buckets.last30d,
        bucket_index,
        from_node_id,
        to_node_id,
        edge.transition_stats.last30d,
    );
    set_transition_bucket_count(
        &mut graph.transition_buckets.last7d,
        bucket_index,
        from_node_id,
        to_node_id,
        edge.transition_stats.last7d,
    );
    set_transition_bucket_count(
        &mut graph.transition_buckets.last1d,
        bucket_index,
        from_node_id,
        to_node_id,
        edge.transition_stats.last1d,
    );
}

fn create_transition_message(
    graph: &Graph,
    sequence_number: u64,
    tab_id: &str,
    previous_node_id: Option<&str>,
    previous_page_url: Option<&str>,
    target_node: &NodeSeed,
    occurred_at: &str,
    event_type: &str,
    transition_type: &str,
    url: &str,
) -> TransitionMessage {
    TransitionMessage {
        sequence_number,
        from_node_id: previous_node_id.map(|value| value.to_owned()),
        to_node_id: target_node.node_id.clone(),
        from_host: previous_node_id.map(|node_id| node_host(graph, node_id)),
        to_host: target_node.host.clone(),
        from_page_url: previous_page_url.map(|value| value.to_owned()),
        to_page_url: url.to_owned(),
        tab_id: tab_id.parse::<i32>().unwrap_or(-1),
        occurred_at: occurred_at.to_owned(),
        event_type: event_type.to_owned(),
        transition_type: transition_type.to_owned(),
        url: url.to_owned(),
    }
}

fn append_transition_message(graph: &mut Graph, transition_message: TransitionMessage) {
    graph.transition_messages.push(transition_message);
}

fn replay_transition_message_into_edge_counts(graph: &mut Graph, transition_message: &TransitionMessage) {
    let Some(from_node_id) = transition_message.from_node_id.as_deref() else {
        return;
    };

    upsert_edge(
        graph,
        from_node_id,
        &transition_message.to_node_id,
        &transition_message.occurred_at,
        &transition_message.transition_type,
    );
}

fn apply_transition_message_to_indexes(graph: &mut Graph, transition_message: &TransitionMessage) {
    replay_transition_message_into_edge_counts(graph, transition_message);
    register_transition_message_in_buckets(
        graph,
        transition_message.from_node_id.as_deref(),
        &transition_message.to_node_id,
        transition_message.sequence_number,
    );
}

fn normalize_transition_messages(transition_messages: &mut Vec<TransitionMessage>) {
    for transition_message in transition_messages.iter_mut() {
        if transition_message.to_page_url.is_empty() {
            transition_message.to_page_url = transition_message.url.clone();
        }

        if transition_message.url.is_empty() {
            transition_message.url = transition_message.to_page_url.clone();
        }

        if transition_message
            .from_page_url
            .as_deref()
            .is_some_and(|value| value.is_empty())
        {
            transition_message.from_page_url = None;
        }
    }

    transition_messages.sort_by(|left, right| {
        let left_sequence = if left.sequence_number == 0 {
            u64::MAX
        } else {
            left.sequence_number
        };
        let right_sequence = if right.sequence_number == 0 {
            u64::MAX
        } else {
            right.sequence_number
        };

        left_sequence
            .cmp(&right_sequence)
            .then_with(|| left.occurred_at.cmp(&right.occurred_at))
    });

    let mut next_sequence = 0;

    for transition_message in transition_messages.iter_mut() {
        if transition_message.sequence_number <= next_sequence {
            next_sequence += 1;
            transition_message.sequence_number = next_sequence;
        } else {
            next_sequence = transition_message.sequence_number;
        }
    }
}

fn reconcile_recent_transition_index_coverage(
    graph: &mut Graph,
    stored_version: u32,
    stored_edge_snapshots: &BTreeMap<String, Option<String>>,
    stored_transition_message_buckets: &TransitionMessageBuckets,
) {
    if stored_version < 5 {
        return;
    }

    let recent_messages: Vec<TransitionMessage> = graph
        .transition_messages
        .iter()
        .rev()
        .take(STARTUP_SYNC_MESSAGE_WINDOW)
        .cloned()
        .collect();

    for transition_message in recent_messages.into_iter().rev() {
        if !should_replay_transition_message_from_startup_check(
            graph,
            stored_edge_snapshots,
            stored_transition_message_buckets,
            &transition_message,
        ) {
            continue;
        }

        replay_transition_message_into_edge_counts(graph, &transition_message);
    }
}

fn should_replay_transition_message_from_startup_check(
    graph: &Graph,
    stored_edge_snapshots: &BTreeMap<String, Option<String>>,
    stored_transition_message_buckets: &TransitionMessageBuckets,
    transition_message: &TransitionMessage,
) -> bool {
    let Some(from_node_id) = transition_message.from_node_id.as_deref() else {
        return false;
    };

    if transition_message.to_node_id.is_empty() {
        return false;
    }

    let edge_id = format!("{from_node_id} -> {}", transition_message.to_node_id);
    let Some(stored_last_seen_at) = stored_edge_snapshots.get(&edge_id) else {
        return true;
    };

    if has_stored_transition_message_reference(
        graph,
        stored_transition_message_buckets,
        transition_message,
    ) {
        return false;
    }

    occurred_after(
        &transition_message.occurred_at,
        stored_last_seen_at.as_deref(),
    )
}

fn has_stored_transition_message_reference(
    graph: &Graph,
    stored_transition_message_buckets: &TransitionMessageBuckets,
    transition_message: &TransitionMessage,
) -> bool {
    let Some(from_node_id) = transition_message.from_node_id.as_deref() else {
        return false;
    };

    let bucket_index = source_bucket_index(graph, from_node_id);
    let Some(bucket) = stored_transition_message_buckets.buckets.get(bucket_index) else {
        return false;
    };
    let Some(source_map) = bucket.get(from_node_id) else {
        return false;
    };
    let Some(target_messages) = source_map.get(&transition_message.to_node_id) else {
        return false;
    };

    target_messages.contains(&transition_message.sequence_number)
}

fn occurred_after(left_occurred_at: &str, right_occurred_at: Option<&str>) -> bool {
    let Some(right_occurred_at) = right_occurred_at else {
        return false;
    };

    left_occurred_at > right_occurred_at
}

fn register_transition_message_in_buckets(
    graph: &mut Graph,
    from_node_id: Option<&str>,
    to_node_id: &str,
    sequence_number: u64,
) {
    let Some(from_node_id) = from_node_id else {
        return;
    };

    if to_node_id.is_empty() || sequence_number == 0 {
        return;
    }

    let bucket_index = source_bucket_index(graph, from_node_id);
    let Some(bucket) = graph.transition_message_buckets.buckets.get_mut(bucket_index) else {
        return;
    };
    let source_map = bucket.entry(from_node_id.to_owned()).or_default();
    let target_messages = source_map.entry(to_node_id.to_owned()).or_default();

    if target_messages.last().copied() != Some(sequence_number) {
        target_messages.push(sequence_number);
    }
}

fn set_transition_bucket_count(
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

fn node_host(graph: &Graph, node_id: &str) -> String {
    graph
        .nodes
        .get(node_id)
        .map(|node| node.host.clone())
        .unwrap_or_else(|| node_id.to_owned())
}

fn source_bucket_index(graph: &Graph, source_node_id: &str) -> usize {
    let bucket_text = node_bucket_label(graph, source_node_id);
    let mut characters = bucket_text.chars();
    let first_index = bucket_char_index(characters.next());
    let second_index = match characters.next() {
        Some(character) => bucket_char_index(Some(character)),
        None => BUCKET_SECONDARY_BLANK_INDEX,
    };

    first_index * (BUCKET_PRIMARY_CHARSET.len() + 1) + second_index
}

fn node_bucket_label(graph: &Graph, node_id: &str) -> String {
    let raw_text = graph
        .nodes
        .get(node_id)
        .map(|node| {
            if !node.hostname.is_empty() {
                node.hostname.clone()
            } else if !node.host.is_empty() {
                node.host.clone()
            } else {
                node_id.to_owned()
            }
        })
        .unwrap_or_else(|| node_id.to_owned())
        .to_lowercase();

    raw_text.strip_prefix("www.").unwrap_or(&raw_text).to_owned()
}

fn bucket_char_index(character: Option<char>) -> usize {
    let normalized = normalize_bucket_char(character);
    BUCKET_PRIMARY_CHARSET
        .chars()
        .position(|candidate| candidate == normalized)
        .unwrap_or(BUCKET_PRIMARY_CHARSET.len() - 1)
}

fn normalize_bucket_char(character: Option<char>) -> char {
    let lowered = character.unwrap_or('_').to_ascii_lowercase();

    if BUCKET_PRIMARY_CHARSET.contains(lowered) {
        lowered
    } else {
        '_'
    }
}

fn build_day_key(timestamp: &str) -> String {
    if timestamp.len() >= 10 {
        let candidate = &timestamp[..10];
        if is_valid_day_key(candidate) {
            return candidate.to_owned();
        }
    }

    "1970-01-01".to_owned()
}

fn is_valid_day_key(value: &str) -> bool {
    value.len() == 10
        && value.chars().enumerate().all(|(index, character)| match index {
            4 | 7 => character == '-',
            _ => character.is_ascii_digit(),
        })
}

fn day_key_to_epoch_day(day_key: &str) -> Option<u64> {
    if !is_valid_day_key(day_key) {
        return None;
    }

    let year = day_key[0..4].parse::<i64>().ok()?;
    let month = day_key[5..7].parse::<u32>().ok()?;
    let day = day_key[8..10].parse::<u32>().ok()?;
    Some(days_from_civil(year, month, day) as u64)
}

fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let adjusted_year = year - i64::from(month <= 2);
    let era = if adjusted_year >= 0 {
        adjusted_year / 400
    } else {
        (adjusted_year - 399) / 400
    };
    let year_of_era = adjusted_year - era * 400;
    let month_index = i64::from(month);
    let day_of_year = (153 * (month_index + if month > 2 { -3 } else { 9 }) + 2) / 5
        + i64::from(day)
        - 1;
    let day_of_era =
        year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;

    era * 146_097 + day_of_era - 719_468
}

fn read_input<'a>(ptr: *const u8, len: usize) -> Result<&'a [u8], String> {
    if len == 0 {
        return Ok(&[]);
    }

    if ptr.is_null() {
        return Err("received null pointer for non-empty input".to_owned());
    }

    unsafe { Ok(std::slice::from_raw_parts(ptr, len)) }
}

fn store_result(bytes: Vec<u8>) -> *mut u8 {
    let len = bytes.len();
    LAST_RESULT_LEN.with(|cell| cell.set(len));

    let mut boxed = bytes.into_boxed_slice();
    let ptr = boxed.as_mut_ptr();
    mem::forget(boxed);
    ptr
}
