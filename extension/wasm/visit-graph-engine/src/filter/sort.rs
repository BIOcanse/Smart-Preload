use super::model::FilterCandidateInput;
use std::cmp::Ordering;

pub(super) fn compare_candidate_priority(
    left: &FilterCandidateInput,
    right: &FilterCandidateInput,
) -> Ordering {
    compare_f64_desc(right.score, left.score)
        .then_with(|| compare_f64_desc(right.visibility_score, left.visibility_score))
        .then_with(|| left.link_index.cmp(&right.link_index))
}

fn compare_f64_desc(left: f64, right: f64) -> Ordering {
    left.partial_cmp(&right).unwrap_or(Ordering::Equal)
}
