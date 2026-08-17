use crate::scoring::{ScoringBreakdown, build_scoring_breakdown};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

const PRELOAD_BASE_SCORE: f64 = 1.0;
const TRANSITION_FREQUENCY_REFERENCE_SET: [u64; 10] = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
const TRANSITION_FREQUENCY_SIGMOID_SCALE: f64 = 2.0;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectPreloadCandidateGroupInput {
    #[serde(default)]
    pub candidates: Vec<PreloadSelectionCandidateInput>,
    #[serde(default)]
    pub page_slot_limit: usize,
    #[serde(default)]
    pub site_selection_limit: usize,
    #[serde(default)]
    pub selection_group: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreloadSelectionCandidateInput {
    pub index: usize,
    #[serde(default)]
    pub node_id: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub target_page_url: String,
    #[serde(default)]
    pub is_same_site: bool,
    #[serde(default)]
    pub site_transition_count: u64,
    #[serde(default)]
    pub site_ai_keyword_multiplier: f64,
    #[serde(default)]
    pub score: f64,
    #[serde(default)]
    pub visibility_score: f64,
    #[serde(default)]
    pub link_index: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectPreloadCandidateGroupResult {
    pub selected_indices: Vec<usize>,
    pub site_selections: Vec<SelectedCandidateSiteSelection>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectedCandidateSiteSelection {
    pub candidate_index: usize,
    pub site_node_id: String,
    pub site_weight: f64,
    pub site_transition_count: u64,
    pub cap: usize,
    pub allocated_slots: usize,
    pub site_rank: usize,
    pub selection_group: String,
    pub site_ai_keyword_multiplier: f64,
    pub site_score_breakdown: ScoringBreakdown,
}

#[derive(Debug, Clone)]
struct SiteCluster {
    node_id: String,
    candidate_indices: Vec<usize>,
    cap: usize,
    site_transition_count: u64,
    site_ai_keyword_multiplier: f64,
    site_weight: f64,
    site_score_breakdown: ScoringBreakdown,
}

pub fn select_preload_candidate_group(
    input: SelectPreloadCandidateGroupInput,
) -> Result<SelectPreloadCandidateGroupResult, String> {
    let candidates = input.candidates;

    if candidates.is_empty() || input.page_slot_limit == 0 {
        return Ok(empty_selection_result());
    }

    let (same_site_indices, cross_site_indices) = partition_candidates_by_site_scope(&candidates);

    if cross_site_indices.is_empty() {
        return Ok(build_selection_result(
            &candidates,
            select_top_candidate_indices(
                &candidates,
                (0..candidates.len()).collect(),
                input.page_slot_limit,
            ),
            Vec::new(),
        ));
    }

    let same_site_indices =
        select_top_candidate_indices(&candidates, same_site_indices, input.page_slot_limit);
    let remaining_cross_site_slots = input
        .page_slot_limit
        .saturating_sub(same_site_indices.len());

    if remaining_cross_site_slots == 0 {
        return Ok(build_selection_result(
            &candidates,
            same_site_indices,
            Vec::new(),
        ));
    }

    let site_clusters = select_cross_site_clusters(
        &candidates,
        &cross_site_indices,
        input.site_selection_limit,
        remaining_cross_site_slots,
    );

    if site_clusters.is_empty() {
        return Ok(build_selection_result(
            &candidates,
            same_site_indices,
            Vec::new(),
        ));
    }

    let allocations =
        allocate_slots_for_selected_site_clusters(remaining_cross_site_slots, &site_clusters)?;
    let (mut selected_working_indices, site_selections) =
        build_selection_from_allocated_site_clusters(
            &candidates,
            same_site_indices,
            &site_clusters,
            &allocations,
            &input.selection_group,
        );
    sort_candidate_indices_by_priority(&candidates, &mut selected_working_indices);

    Ok(build_selection_result(
        &candidates,
        selected_working_indices,
        site_selections,
    ))
}

fn empty_selection_result() -> SelectPreloadCandidateGroupResult {
    SelectPreloadCandidateGroupResult {
        selected_indices: Vec::new(),
        site_selections: Vec::new(),
    }
}

fn partition_candidates_by_site_scope(
    candidates: &[PreloadSelectionCandidateInput],
) -> (Vec<usize>, Vec<usize>) {
    candidates.iter().enumerate().fold(
        (Vec::new(), Vec::new()),
        |mut partition, (index, candidate)| {
            if candidate.is_same_site {
                partition.0.push(index);
            } else {
                partition.1.push(index);
            }
            partition
        },
    )
}

fn select_top_candidate_indices(
    candidates: &[PreloadSelectionCandidateInput],
    mut candidate_indices: Vec<usize>,
    limit: usize,
) -> Vec<usize> {
    sort_candidate_indices_by_priority(candidates, &mut candidate_indices);
    candidate_indices.truncate(limit);
    candidate_indices
}

fn sort_candidate_indices_by_priority(
    candidates: &[PreloadSelectionCandidateInput],
    candidate_indices: &mut [usize],
) {
    candidate_indices
        .sort_by(|left, right| compare_candidate_priority(&candidates[*left], &candidates[*right]));
}

fn select_cross_site_clusters(
    candidates: &[PreloadSelectionCandidateInput],
    cross_site_indices: &[usize],
    site_selection_limit: usize,
    remaining_cross_site_slots: usize,
) -> Vec<SiteCluster> {
    let mut site_clusters = build_cross_site_clusters(candidates, cross_site_indices);
    site_clusters.sort_by(|left, right| compare_site_cluster_priority(left, right, candidates));
    let selected_site_count = site_selection_limit
        .min(remaining_cross_site_slots)
        .min(site_clusters.len());
    site_clusters.truncate(selected_site_count);
    site_clusters
}

fn allocate_slots_for_selected_site_clusters(
    remaining_cross_site_slots: usize,
    site_clusters: &[SiteCluster],
) -> Result<Vec<usize>, String> {
    let total_selected_site_cap = site_clusters
        .iter()
        .map(|site_cluster| site_cluster.cap)
        .sum::<usize>();
    let allocated_page_slot_count = remaining_cross_site_slots.min(total_selected_site_cap);

    allocate_selected_site_page_slots(
        allocated_page_slot_count,
        &site_clusters
            .iter()
            .map(|site_cluster| site_cluster.site_weight)
            .collect::<Vec<f64>>(),
        &site_clusters
            .iter()
            .map(|site_cluster| site_cluster.cap)
            .collect::<Vec<usize>>(),
    )
}

fn build_selection_from_allocated_site_clusters(
    candidates: &[PreloadSelectionCandidateInput],
    mut selected_working_indices: Vec<usize>,
    site_clusters: &[SiteCluster],
    allocations: &[usize],
    selection_group: &str,
) -> (Vec<usize>, Vec<SelectedCandidateSiteSelection>) {
    let mut site_selections = Vec::new();

    for (site_rank, site_cluster) in site_clusters.iter().enumerate() {
        let allocated_slots = allocations.get(site_rank).copied().unwrap_or(0);

        if allocated_slots == 0 {
            continue;
        }

        append_allocated_site_cluster_selection(
            candidates,
            &mut selected_working_indices,
            &mut site_selections,
            site_cluster,
            allocated_slots,
            site_rank + 1,
            selection_group,
        );
    }

    (selected_working_indices, site_selections)
}

fn append_allocated_site_cluster_selection(
    candidates: &[PreloadSelectionCandidateInput],
    selected_working_indices: &mut Vec<usize>,
    site_selections: &mut Vec<SelectedCandidateSiteSelection>,
    site_cluster: &SiteCluster,
    allocated_slots: usize,
    site_rank: usize,
    selection_group: &str,
) {
    for candidate_index in site_cluster
        .candidate_indices
        .iter()
        .copied()
        .take(allocated_slots)
    {
        selected_working_indices.push(candidate_index);
        site_selections.push(SelectedCandidateSiteSelection {
            candidate_index: candidates[candidate_index].index,
            site_node_id: site_cluster.node_id.clone(),
            site_weight: site_cluster.site_weight,
            site_transition_count: site_cluster.site_transition_count,
            cap: site_cluster.cap,
            allocated_slots,
            site_rank,
            selection_group: selection_group.to_owned(),
            site_ai_keyword_multiplier: site_cluster.site_ai_keyword_multiplier,
            site_score_breakdown: site_cluster.site_score_breakdown.clone(),
        });
    }
}

fn build_selection_result(
    candidates: &[PreloadSelectionCandidateInput],
    selected_working_indices: Vec<usize>,
    site_selections: Vec<SelectedCandidateSiteSelection>,
) -> SelectPreloadCandidateGroupResult {
    SelectPreloadCandidateGroupResult {
        selected_indices: selected_working_indices
            .into_iter()
            .map(|candidate_index| candidates[candidate_index].index)
            .collect(),
        site_selections,
    }
}

fn build_cross_site_clusters(
    candidates: &[PreloadSelectionCandidateInput],
    cross_site_indices: &[usize],
) -> Vec<SiteCluster> {
    let mut candidate_indices_by_node_id = BTreeMap::<String, Vec<usize>>::new();

    for candidate_index in cross_site_indices {
        let candidate = &candidates[*candidate_index];

        if candidate.node_id.is_empty() {
            continue;
        }

        candidate_indices_by_node_id
            .entry(candidate.node_id.clone())
            .or_default()
            .push(*candidate_index);
    }

    candidate_indices_by_node_id
        .into_iter()
        .filter_map(|(node_id, mut candidate_indices)| {
            candidate_indices.sort_by(|left, right| {
                compare_candidate_priority(&candidates[*left], &candidates[*right])
            });

            if candidate_indices.is_empty() {
                return None;
            }

            let mut unique_page_urls = BTreeSet::<String>::new();
            let mut site_transition_count = 0_u64;
            let mut site_ai_keyword_multiplier = 1.0_f64;

            for candidate_index in &candidate_indices {
                let candidate = &candidates[*candidate_index];
                let page_url = if candidate.target_page_url.is_empty() {
                    &candidate.url
                } else {
                    &candidate.target_page_url
                };

                if !page_url.is_empty() {
                    unique_page_urls.insert(page_url.clone());
                }

                site_transition_count = site_transition_count.max(candidate.site_transition_count);

                if candidate.site_ai_keyword_multiplier.is_finite() {
                    site_ai_keyword_multiplier =
                        site_ai_keyword_multiplier.max(candidate.site_ai_keyword_multiplier);
                }
            }

            let cap = unique_page_urls.len().max(candidate_indices.len()).max(1);
            let mut multipliers =
                vec![transition_frequency_score_multiplier(site_transition_count)];

            if site_ai_keyword_multiplier > 1.0 {
                multipliers.push(site_ai_keyword_multiplier);
            }

            let site_score_breakdown = build_scoring_breakdown(PRELOAD_BASE_SCORE, &multipliers);

            Some(SiteCluster {
                node_id,
                candidate_indices,
                cap,
                site_transition_count,
                site_ai_keyword_multiplier,
                site_weight: site_score_breakdown.normalized_score,
                site_score_breakdown,
            })
        })
        .collect()
}

fn transition_frequency_score_multiplier(transition_count: u64) -> f64 {
    if transition_count == 0 {
        return 1.0;
    }

    let logs = TRANSITION_FREQUENCY_REFERENCE_SET
        .iter()
        .map(|value| (*value as f64).ln())
        .collect::<Vec<f64>>();
    let mean = logs.iter().sum::<f64>() / logs.len() as f64;
    let variance = logs
        .iter()
        .map(|value| (value - mean) * (value - mean))
        .sum::<f64>()
        / logs.len() as f64;
    let sd = variance.sqrt();

    if sd <= 0.0 || !sd.is_finite() {
        return 1.0;
    }

    let normalized_log_distance = ((transition_count as f64).ln() - mean) / sd;
    1.0 + TRANSITION_FREQUENCY_SIGMOID_SCALE / (1.0 + (-normalized_log_distance).exp())
}

fn allocate_selected_site_page_slots(
    page_slot_count: usize,
    scores: &[f64],
    caps: &[usize],
) -> Result<Vec<usize>, String> {
    if scores.is_empty() || scores.len() != caps.len() {
        return Err("scores and caps must have the same non-zero length".to_owned());
    }

    let selected_count = scores.len();

    if page_slot_count < selected_count {
        return Err("page slot count is smaller than selected site count".to_owned());
    }

    let total_cap = caps.iter().sum::<usize>();

    if page_slot_count > total_cap {
        return Err("page slot count is greater than selected site capacity".to_owned());
    }

    for (index, score) in scores.iter().enumerate() {
        if !score.is_finite() || *score <= 0.0 {
            return Err(format!("scores[{index}] must be a positive finite number"));
        }

        if caps[index] == 0 {
            return Err(format!("caps[{index}] must be >= 1"));
        }
    }

    let mut baseline = vec![1_usize; selected_count];
    let remaining_slots = page_slot_count - selected_count;

    if remaining_slots == 0 {
        return Ok(baseline);
    }

    let extra_caps = caps.iter().map(|cap| cap - 1).collect::<Vec<usize>>();
    let weights = scores
        .iter()
        .map(|score| score.sqrt())
        .collect::<Vec<f64>>();
    let total_weight = weights.iter().sum::<f64>();

    if total_weight <= 0.0 || !total_weight.is_finite() {
        return Err("total transformed site weight must be positive".to_owned());
    }

    let targets = weights
        .iter()
        .map(|weight| remaining_slots as f64 * weight / total_weight)
        .collect::<Vec<f64>>();
    let mut previous = vec![f64::INFINITY; remaining_slots + 1];
    previous[0] = 0.0;
    let mut choice = vec![vec![-1_isize; remaining_slots + 1]; selected_count];
    let mut parent_sum = vec![vec![-1_isize; remaining_slots + 1]; selected_count];

    for site_index in 0..selected_count {
        let mut current = vec![f64::INFINITY; remaining_slots + 1];
        let max_extra_cap = extra_caps[site_index].min(remaining_slots);

        for (partial_sum, previous_cost) in previous.iter().enumerate() {
            if !previous_cost.is_finite() {
                continue;
            }

            for extra_count in 0..=max_extra_cap {
                let next_sum = partial_sum + extra_count;

                if next_sum > remaining_slots {
                    break;
                }

                let delta = extra_count as f64 - targets[site_index];
                let cost = previous_cost + delta * delta;

                if cost < current[next_sum] {
                    current[next_sum] = cost;
                    choice[site_index][next_sum] = extra_count as isize;
                    parent_sum[site_index][next_sum] = partial_sum as isize;
                }
            }
        }

        previous = current;
    }

    if !previous[remaining_slots].is_finite() {
        return Err("no feasible slot allocation exists".to_owned());
    }

    let mut extra = vec![0_usize; selected_count];
    let mut partial_sum = remaining_slots;

    for site_index in (0..selected_count).rev() {
        let extra_count = choice[site_index][partial_sum];

        if extra_count < 0 {
            return Err("slot allocation backtracking failed".to_owned());
        }

        extra[site_index] = extra_count as usize;
        let parent = parent_sum[site_index][partial_sum];

        if parent < 0 && site_index > 0 {
            return Err("slot allocation parent tracking failed".to_owned());
        }

        partial_sum = parent.max(0) as usize;
    }

    for (index, extra_count) in extra.into_iter().enumerate() {
        baseline[index] += extra_count;
    }

    Ok(baseline)
}

fn compare_site_cluster_priority(
    left: &SiteCluster,
    right: &SiteCluster,
    candidates: &[PreloadSelectionCandidateInput],
) -> Ordering {
    compare_f64_desc(left.site_weight, right.site_weight)
        .then_with(|| right.site_transition_count.cmp(&left.site_transition_count))
        .then_with(|| {
            let left_best_candidate = left
                .candidate_indices
                .first()
                .map(|index| &candidates[*index]);
            let right_best_candidate = right
                .candidate_indices
                .first()
                .map(|index| &candidates[*index]);

            match (left_best_candidate, right_best_candidate) {
                (Some(left_candidate), Some(right_candidate)) => {
                    compare_candidate_priority(left_candidate, right_candidate)
                }
                _ => Ordering::Equal,
            }
        })
        .then_with(|| left.node_id.cmp(&right.node_id))
}

fn compare_candidate_priority(
    left: &PreloadSelectionCandidateInput,
    right: &PreloadSelectionCandidateInput,
) -> Ordering {
    compare_f64_desc(left.score, right.score)
        .then_with(|| compare_f64_desc(left.visibility_score, right.visibility_score))
        .then_with(|| left.link_index.cmp(&right.link_index))
        .then_with(|| left.index.cmp(&right.index))
}

fn compare_f64_desc(left: f64, right: f64) -> Ordering {
    let left_value = if left.is_finite() { left } else { 0.0 };
    let right_value = if right.is_finite() { right } else { 0.0 };

    right_value
        .partial_cmp(&left_value)
        .unwrap_or(Ordering::Equal)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    fn candidate(
        index: usize,
        is_same_site: bool,
        node_id: &str,
        score: f64,
    ) -> PreloadSelectionCandidateInput {
        PreloadSelectionCandidateInput {
            index,
            node_id: node_id.to_owned(),
            url: format!("https://{node_id}/page{index}"),
            target_page_url: format!("https://{node_id}/page{index}"),
            is_same_site,
            site_transition_count: 1,
            site_ai_keyword_multiplier: 1.0,
            score,
            visibility_score: 0.0,
            link_index: index,
        }
    }

    fn input(
        candidates: Vec<PreloadSelectionCandidateInput>,
        page_slot_limit: usize,
        site_selection_limit: usize,
    ) -> SelectPreloadCandidateGroupInput {
        SelectPreloadCandidateGroupInput {
            candidates,
            page_slot_limit,
            site_selection_limit,
            selection_group: "test-group".to_owned(),
        }
    }

    // --- 入口的空与边界 ---

    #[test]
    fn returns_empty_for_no_candidates_or_no_slots() {
        assert!(
            select_preload_candidate_group(input(Vec::new(), 5, 3))
                .expect("empty input must not error")
                .selected_indices
                .is_empty()
        );
        assert!(
            select_preload_candidate_group(input(vec![candidate(0, true, "a.test", 1.0)], 0, 3))
                .expect("zero slot limit must not error")
                .selected_indices
                .is_empty()
        );
    }

    #[test]
    fn same_site_only_takes_top_n_by_priority() {
        let candidates = vec![
            candidate(0, true, "a.test", 1.0),
            candidate(1, true, "a.test", 9.0),
            candidate(2, true, "a.test", 5.0),
        ];
        let result = select_preload_candidate_group(input(candidates, 2, 3))
            .expect("same-site selection must not error");

        // 没有跨站候选时不做站点聚类，直接按优先级取前 N。
        assert_eq!(result.selected_indices, vec![1, 2]);
        assert!(result.site_selections.is_empty());
    }

    #[test]
    fn priority_order_is_score_then_visibility_then_link_index() {
        let mut high_visibility = candidate(7, true, "a.test", 4.0);
        high_visibility.visibility_score = 0.9;
        let mut low_visibility = candidate(3, true, "a.test", 4.0);
        low_visibility.visibility_score = 0.1;

        let result = select_preload_candidate_group(input(
            vec![
                low_visibility,
                high_visibility,
                candidate(1, true, "a.test", 4.0),
            ],
            3,
            3,
        ))
        .expect("tie-breaking must not error");

        // 分数相同 -> 可见度降序；可见度也相同(0.0)的排最后，再按 link_index 升序。
        assert_eq!(result.selected_indices, vec![7, 3, 1]);
    }

    // --- 跨站点聚类与整体约束 ---

    #[test]
    fn cross_site_respects_site_selection_limit() {
        let candidates = vec![
            candidate(0, false, "a.test", 9.0),
            candidate(1, false, "b.test", 8.0),
            candidate(2, false, "c.test", 7.0),
            candidate(3, false, "d.test", 6.0),
        ];
        let result = select_preload_candidate_group(input(candidates, 4, 2))
            .expect("cross-site selection must not error");

        let distinct_sites = result
            .site_selections
            .iter()
            .map(|selection| selection.site_node_id.clone())
            .collect::<BTreeSet<String>>();

        assert!(
            distinct_sites.len() <= 2,
            "site_selection_limit=2 被突破: {distinct_sites:?}"
        );
    }

    #[test]
    fn selection_never_exceeds_page_slot_limit() {
        for page_slot_limit in 1..=6 {
            let candidates = (0..8)
                .map(|index| {
                    candidate(
                        index,
                        index % 3 == 0,
                        &format!("site{}.test", index % 4),
                        9.0 - index as f64,
                    )
                })
                .collect::<Vec<_>>();
            let result = select_preload_candidate_group(input(candidates, page_slot_limit, 3))
                .expect("mixed selection must not error");

            assert!(
                result.selected_indices.len() <= page_slot_limit,
                "page_slot_limit={page_slot_limit} 被突破: {:?}",
                result.selected_indices
            );
        }
    }

    #[test]
    fn selected_indices_are_unique_and_in_range() {
        let candidates = (0..10)
            .map(|index| {
                candidate(
                    index,
                    index % 2 == 0,
                    &format!("site{}.test", index % 3),
                    5.0,
                )
            })
            .collect::<Vec<_>>();
        let candidate_count = candidates.len();
        let result = select_preload_candidate_group(input(candidates, 6, 3))
            .expect("selection must succeed");

        let unique = result
            .selected_indices
            .iter()
            .copied()
            .collect::<BTreeSet<usize>>();

        assert_eq!(unique.len(), result.selected_indices.len(), "出现重复下标");
        assert!(
            result
                .selected_indices
                .iter()
                .all(|index| *index < candidate_count),
            "出现越界下标"
        );
    }

    #[test]
    fn result_is_deterministic_for_identical_input() {
        let build = || {
            (0..12)
                .map(|index| {
                    candidate(
                        index,
                        index % 4 == 0,
                        &format!("site{}.test", index % 5),
                        (index % 7) as f64 + 1.0,
                    )
                })
                .collect::<Vec<_>>()
        };
        let first = select_preload_candidate_group(input(build(), 5, 3)).expect("first run");
        let second = select_preload_candidate_group(input(build(), 5, 3)).expect("second run");

        assert_eq!(first.selected_indices, second.selected_indices);
    }

    // --- 槽位分配器（动态规划）---
    //
    // 这是 crate 里唯一的动态规划，此前零覆盖。clippy 对它有一条
    // needless_range_loop 告警，在补上这些测试之前不要去改那个循环。

    #[test]
    fn allocator_gives_every_site_at_least_one_slot() {
        let allocation = allocate_selected_site_page_slots(5, &[4.0, 1.0, 1.0], &[3, 3, 3])
            .expect("allocation must succeed");

        assert_eq!(allocation.iter().sum::<usize>(), 5);
        assert!(
            allocation.iter().all(|slots| *slots >= 1),
            "有站点分到 0 槽位: {allocation:?}"
        );
    }

    #[test]
    fn allocator_favours_higher_weight_sites() {
        let allocation = allocate_selected_site_page_slots(6, &[16.0, 1.0, 1.0], &[4, 4, 4])
            .expect("allocation must succeed");

        assert_eq!(allocation.iter().sum::<usize>(), 6);
        assert!(
            allocation[0] > allocation[1] && allocation[0] > allocation[2],
            "权重最高的站点没有拿到最多槽位: {allocation:?}"
        );
    }

    #[test]
    fn allocator_never_exceeds_per_site_cap() {
        let allocation = allocate_selected_site_page_slots(5, &[100.0, 1.0], &[2, 3])
            .expect("allocation must succeed");

        assert_eq!(allocation.iter().sum::<usize>(), 5);
        assert!(allocation[0] <= 2, "突破了 cap=2: {allocation:?}");
        assert!(allocation[1] <= 3, "突破了 cap=3: {allocation:?}");
    }

    #[test]
    fn allocator_handles_exact_fit_without_extras() {
        // page_slot_count == selected_count：每站恰好一个，不进入 DP。
        let allocation = allocate_selected_site_page_slots(3, &[5.0, 3.0, 1.0], &[2, 2, 2])
            .expect("allocation must succeed");

        assert_eq!(allocation, vec![1, 1, 1]);
    }

    #[test]
    fn allocator_rejects_impossible_inputs() {
        // 槽位少于站点数
        assert!(allocate_selected_site_page_slots(2, &[1.0, 1.0, 1.0], &[2, 2, 2]).is_err());
        // 槽位超过总容量
        assert!(allocate_selected_site_page_slots(7, &[1.0, 1.0], &[3, 3]).is_err());
        // 非正 / 非有限权重
        assert!(allocate_selected_site_page_slots(3, &[1.0, 0.0], &[2, 2]).is_err());
        assert!(allocate_selected_site_page_slots(3, &[1.0, f64::NAN], &[2, 2]).is_err());
        assert!(allocate_selected_site_page_slots(3, &[1.0, f64::INFINITY], &[2, 2]).is_err());
        // cap 为 0
        assert!(allocate_selected_site_page_slots(2, &[1.0, 1.0], &[2, 0]).is_err());
    }

    #[test]
    fn allocator_output_length_matches_site_count() {
        for site_count in 1..=5 {
            let scores = vec![2.0; site_count];
            let caps = vec![3; site_count];
            let allocation = allocate_selected_site_page_slots(site_count * 2, &scores, &caps)
                .expect("allocation must succeed");

            assert_eq!(allocation.len(), site_count);
            assert_eq!(allocation.iter().sum::<usize>(), site_count * 2);
        }
    }
}
