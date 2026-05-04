use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Serialize;

use crate::api::ApiState;
use crate::telemetry::{
    collect_activity_snapshot, ActivitySnapshot, HardwareSnapshot, PerformanceSnapshot,
    SystemSnapshot,
};

pub(crate) async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { ok: true })
}

pub(crate) async fn system_snapshot(
    State(state): State<ApiState>,
) -> Result<Json<SystemSnapshot>, (StatusCode, String)> {
    state
        .snapshot()
        .map(Json)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

pub(crate) async fn system_hardware(
    State(state): State<ApiState>,
) -> Result<Json<HardwareSnapshot>, (StatusCode, String)> {
    state
        .snapshot()
        .map(|snapshot| Json(snapshot.hardware))
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

pub(crate) async fn system_performance(
    State(state): State<ApiState>,
) -> Result<Json<PerformanceSnapshot>, (StatusCode, String)> {
    state
        .snapshot()
        .map(|snapshot| Json(snapshot.performance))
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

pub(crate) async fn system_activity() -> Json<ActivitySnapshot> {
    Json(collect_activity_snapshot())
}

#[derive(Debug, Serialize)]
pub(crate) struct HealthResponse {
    ok: bool,
}
