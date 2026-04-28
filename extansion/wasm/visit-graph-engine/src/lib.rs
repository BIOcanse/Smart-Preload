mod db;
mod events;
mod ffi;
mod filter;
mod model;
mod query;
mod responses;
pub mod scoring;

use ffi::{read_input, store_result};
use filter::{FilterCandidatesInput, FilterCandidatesResult, filter_candidates};
use model::{EngineEvent, EngineQuery, TrackingState};
use responses::{
    ApplyEventResponse, FilterCandidatesResponse, QueryStateResponse, ScoreWeightsBatchResponse,
    ScoreWeightsResponse, serialize_response,
};
use scoring::{ScoreWeightsBatchInput, ScoreWeightsInput, score_weights, score_weights_batch};
use serde_json::Value;

use events::apply_event;
use query::execute_query;

pub(crate) use model::{
    Edge, ForegroundPageRecord, Graph, Node, NodeSeed, PageKeywordEntry, PageTransitionBuckets,
    PageTransitionMessageBuckets, PendingSource, TabStateEntry, TransitionBuckets,
    TransitionMessage, TransitionMessageBuckets, TransitionStats,
};

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

    store_result(serialize_response(&response))
}

#[unsafe(no_mangle)]
pub extern "C" fn query_state_json(
    state_ptr: *const u8,
    state_len: usize,
    query_ptr: *const u8,
    query_len: usize,
) -> *mut u8 {
    let response = match query_state_json_inner(state_ptr, state_len, query_ptr, query_len) {
        Ok(result) => QueryStateResponse {
            ok: true,
            result: Some(result),
            error: None,
        },
        Err(error) => QueryStateResponse {
            ok: false,
            result: None,
            error: Some(error),
        },
    };

    store_result(serialize_response(&response))
}

#[unsafe(no_mangle)]
pub extern "C" fn score_weights_json(input_ptr: *const u8, input_len: usize) -> *mut u8 {
    let response = match score_weights_json_inner(input_ptr, input_len) {
        Ok(result) => ScoreWeightsResponse {
            ok: true,
            result: Some(result),
            error: None,
        },
        Err(error) => ScoreWeightsResponse {
            ok: false,
            result: None,
            error: Some(error),
        },
    };

    store_result(serialize_response(&response))
}

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

    db::normalize_graph(&mut state.graph);
    apply_event(&mut state, event);
    Ok(state)
}

fn query_state_json_inner(
    state_ptr: *const u8,
    state_len: usize,
    query_ptr: *const u8,
    query_len: usize,
) -> Result<Value, String> {
    let mut state = if state_len == 0 {
        TrackingState::default()
    } else {
        serde_json::from_slice::<TrackingState>(read_input(state_ptr, state_len)?)
            .map_err(|error| format!("failed to parse state JSON: {error}"))?
    };

    let query = serde_json::from_slice::<EngineQuery>(read_input(query_ptr, query_len)?)
        .map_err(|error| format!("failed to parse query JSON: {error}"))?;

    db::normalize_graph(&mut state.graph);
    execute_query(&state.graph, query)
}

fn score_weights_json_inner(
    input_ptr: *const u8,
    input_len: usize,
) -> Result<scoring::ScoringBreakdown, String> {
    let input = serde_json::from_slice::<ScoreWeightsInput>(read_input(input_ptr, input_len)?)
        .map_err(|error| format!("failed to parse scoring JSON: {error}"))?;

    Ok(score_weights(input))
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
