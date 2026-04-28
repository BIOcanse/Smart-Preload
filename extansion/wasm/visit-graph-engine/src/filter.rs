mod model;
mod rules;
mod sort;

#[allow(unused_imports)]
pub use model::FilterRuleCardStateInput;
#[allow(unused_imports)]
pub use model::{FilterCandidateInput, FilterCandidatesInput, FilterCandidatesResult};
use rules::{evaluate_rule_card_metric, is_rule_card_enabled};
use sort::compare_candidate_priority;

pub fn filter_candidates(input: FilterCandidatesInput) -> FilterCandidatesResult {
    let FilterCandidatesInput {
        ordered_rule_ids,
        rule_items,
        max_targets,
        candidates,
    } = input;
    let mut working_indices = (0..candidates.len()).collect::<Vec<usize>>();

    for rule_id in ordered_rule_ids {
        let Some(rule_card_state) = rule_items.get(&rule_id) else {
            continue;
        };

        if !is_rule_card_enabled(rule_card_state) {
            continue;
        }

        match rule_id.as_str() {
            "highWeightRank" => {}
            "highWeightRankTab" => {}
            "weightRange" => {
                working_indices.retain(|candidate_index| {
                    evaluate_rule_card_metric(rule_card_state, candidates[*candidate_index].score)
                });
            }
            _ => {}
        }
    }

    let mut ordered_indices = working_indices.clone();
    ordered_indices.sort_by(|left_index, right_index| {
        compare_candidate_priority(&candidates[*left_index], &candidates[*right_index])
    });
    let selected_indices = ordered_indices
        .iter()
        .take(max_targets.unwrap_or(ordered_indices.len()))
        .copied()
        .collect::<Vec<usize>>();

    FilterCandidatesResult {
        kept_indices: working_indices,
        ordered_indices,
        selected_indices,
    }
}
