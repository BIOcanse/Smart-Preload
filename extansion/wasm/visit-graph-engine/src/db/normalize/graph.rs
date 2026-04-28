use super::*;

pub(crate) fn normalize_graph(graph: &mut Graph) {
    let stored_version = graph.version;
    let stored_edge_snapshots: BTreeMap<String, Option<String>> = graph
        .edges
        .iter()
        .map(|(edge_id, edge)| (edge_id.clone(), Some(edge.last_seen_at.clone())))
        .collect();
    let stored_transition_message_buckets = graph.transition_message_buckets.clone();

    graph.version = 10;

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

                (
                    buckets::node_host(graph, &from_node_id),
                    buckets::node_host(graph, &to_node_id),
                )
            })
            .unwrap_or_else(|| (String::new(), String::new()));

        if let Some(edge) = graph.edges.get_mut(&edge_id) {
            normalize_edge(&edge_id, edge, from_host_fallback, to_host_fallback);
        }
    }

    normalize_transition_messages(&mut graph.transition_messages);
    graph.transition_sequence = graph.transition_sequence.max(
        graph
            .transition_messages
            .iter()
            .map(|message| message.sequence_number)
            .max()
            .unwrap_or(0),
    );

    graph.transition_buckets = TransitionBuckets::default();
    graph.transition_message_buckets = TransitionMessageBuckets::default();
    graph.page_transition_buckets = PageTransitionBuckets::default();
    graph.page_transition_message_buckets = PageTransitionMessageBuckets::default();
    learning::normalize_link_behavior_store(&mut graph.link_behavior_store);
    learning::normalize_page_keyword_store(&mut graph.page_keyword_store);
    graph.page_keyword_buckets = PageKeywordBuckets::default();
    learning::normalize_recent_foreground_pages(&mut graph.recent_foreground_pages);
    learning::normalize_history_page_pool(
        &mut graph.history_page_titles,
        &mut graph.history_page_urls,
        &mut graph.history_page_texts,
        &graph.recent_foreground_pages,
    );
    graph.transition_messages_by_day = BTreeMap::new();

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

    reconcile::reconcile_recent_transition_index_coverage(
        graph,
        stored_version,
        &stored_edge_snapshots,
        &stored_transition_message_buckets,
    );

    for transition_message in graph.transition_messages.clone() {
        register_transition_message_in_day_groups(graph, &transition_message);
        register_transition_message_in_buckets(
            graph,
            transition_message.from_node_id.as_deref(),
            &transition_message.to_node_id,
            transition_message.sequence_number,
        );
        register_transition_message_in_page_indexes(graph, &transition_message);
    }

    let page_keyword_entries = graph
        .page_keyword_store
        .values()
        .cloned()
        .collect::<Vec<PageKeywordEntry>>();

    for page_keyword_entry in page_keyword_entries {
        learning::register_page_keyword_entry(graph, &page_keyword_entry);
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
            .insert(buckets::build_day_key(&edge.last_seen_at), edge.count);
    }

    let reference_at = edge.last_seen_at.clone();
    recalculate_edge_transition_stats(edge, &reference_at);
}

pub(crate) fn recalculate_edge_transition_stats(edge: &mut Edge, reference_at: &str) {
    let reference_day =
        buckets::day_key_to_epoch_day(&buckets::build_day_key(reference_at)).unwrap_or(0);
    let mut next_daily_counts = BTreeMap::new();
    let mut next_stats = TransitionStats {
        total: edge.count,
        ..TransitionStats::default()
    };

    for (day_key, count) in edge.daily_counts.iter() {
        let Some(day_number) = buckets::day_key_to_epoch_day(day_key) else {
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
