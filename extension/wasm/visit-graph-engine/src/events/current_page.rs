use crate::{NodeSeed, TabStateEntry, TrackingState, db::upsert_node};

pub(crate) fn set_current_page(
    state: &mut TrackingState,
    tab_id: String,
    target_node: NodeSeed,
    occurred_at: String,
    url: String,
) {
    let previous_node_id = state
        .tab_state
        .get(&tab_id)
        .map(|entry| entry.node_id.clone());
    let previous_page_url = state.tab_state.get(&tab_id).map(|entry| entry.url.clone());
    let is_new_page_visit = previous_page_url.as_deref() != Some(url.as_str());

    upsert_node(&mut state.graph, &target_node, &occurred_at);

    let is_new_node_visit = previous_node_id
        .as_ref()
        .map(|node_id| node_id != &target_node.node_id)
        .unwrap_or(true);

    if is_new_node_visit {
        if let Some(node) = state.graph.nodes.get_mut(&target_node.node_id) {
            node.visit_count += 1;
        }
    }

    if is_new_node_visit || is_new_page_visit {
        state.graph.updated_at = Some(occurred_at.clone());
    }

    state.tab_state.insert(
        tab_id,
        TabStateEntry {
            node_id: target_node.node_id.clone(),
            url,
            updated_at: occurred_at,
        },
    );
}
