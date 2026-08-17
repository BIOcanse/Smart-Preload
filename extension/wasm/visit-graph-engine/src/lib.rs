mod ffi;
mod filter;
mod responses;
pub mod scoring;
mod selection;

use ffi::{read_input, store_result};
use filter::{FilterCandidatesInput, FilterCandidatesResult, filter_candidates};
use responses::{
    FilterCandidatesResponse, ScoreWeightsBatchResponse, SelectPreloadCandidateGroupResponse,
    serialize_response,
};
use scoring::{ScoreWeightsBatchInput, score_weights_batch};
use selection::{SelectPreloadCandidateGroupInput, select_preload_candidate_group};

#[unsafe(no_mangle)]
pub extern "C" fn score_weights_batch_json(input_ptr: *const u8, input_len: usize) -> *mut u8 {
    let response = match score_weights_batch_json_inner(input_ptr, input_len) {
        Ok(result) => ScoreWeightsBatchResponse {
            ok: true,
            result: Some(result),
            error: None,
        },
        Err(error) => ScoreWeightsBatchResponse {
            ok: false,
            result: None,
            error: Some(error),
        },
    };

    store_result(serialize_response(&response))
}

#[unsafe(no_mangle)]
pub extern "C" fn filter_candidate_metrics_json(input_ptr: *const u8, input_len: usize) -> *mut u8 {
    let response = match filter_candidate_metrics_json_inner(input_ptr, input_len) {
        Ok(result) => FilterCandidatesResponse {
            ok: true,
            result: Some(result),
            error: None,
        },
        Err(error) => FilterCandidatesResponse {
            ok: false,
            result: None,
            error: Some(error),
        },
    };

    store_result(serialize_response(&response))
}

#[unsafe(no_mangle)]
pub extern "C" fn select_preload_candidate_group_json(
    input_ptr: *const u8,
    input_len: usize,
) -> *mut u8 {
    let response = match select_preload_candidate_group_json_inner(input_ptr, input_len) {
        Ok(result) => SelectPreloadCandidateGroupResponse {
            ok: true,
            result: Some(result),
            error: None,
        },
        Err(error) => SelectPreloadCandidateGroupResponse {
            ok: false,
            result: None,
            error: Some(error),
        },
    };

    store_result(serialize_response(&response))
}

fn score_weights_batch_json_inner(
    input_ptr: *const u8,
    input_len: usize,
) -> Result<Vec<scoring::ScoringBreakdown>, String> {
    let input = serde_json::from_slice::<ScoreWeightsBatchInput>(read_input(input_ptr, input_len)?)
        .map_err(|error| format!("failed to parse scoring batch JSON: {error}"))?;

    Ok(score_weights_batch(input))
}

fn filter_candidate_metrics_json_inner(
    input_ptr: *const u8,
    input_len: usize,
) -> Result<FilterCandidatesResult, String> {
    let input = serde_json::from_slice::<FilterCandidatesInput>(read_input(input_ptr, input_len)?)
        .map_err(|error| format!("failed to parse filter JSON: {error}"))?;

    Ok(filter_candidates(input))
}

fn select_preload_candidate_group_json_inner(
    input_ptr: *const u8,
    input_len: usize,
) -> Result<selection::SelectPreloadCandidateGroupResult, String> {
    let input = serde_json::from_slice::<SelectPreloadCandidateGroupInput>(read_input(
        input_ptr, input_len,
    )?)
    .map_err(|error| format!("failed to parse preload site selection JSON: {error}"))?;

    select_preload_candidate_group(input)
}
