use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::api::{extension_origin_from_headers, ApiState};
use crate::runtime_debug::record_app_runtime_event;

pub(crate) async fn register_extension(
    State(state): State<ApiState>,
    headers: HeaderMap,
) -> Result<Json<RegisterExtensionResponse>, (StatusCode, String)> {
    let origin = extension_origin_from_headers(&headers).ok_or_else(|| {
        record_app_runtime_event("api", "extension-register-missing-origin", None);
        (
            StatusCode::BAD_REQUEST,
            "missing extension origin".to_string(),
        )
    })?;
    let registered = state
        .register_extension_origin(&origin)
        .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;

    if !registered {
        record_app_runtime_event("api", "extension-register-rejected", Some(origin.clone()));
        return Err((
            StatusCode::FORBIDDEN,
            "extension origin does not match registered extension".to_string(),
        ));
    }

    record_app_runtime_event("api", "extension-register-succeeded", Some(origin.clone()));

    Ok(Json(RegisterExtensionResponse {
        ok: true,
        allowed_origin: state.get_allowed_extension_origin().unwrap_or(origin),
        allowed_origins: state.get_allowed_extension_origins(),
    }))
}

pub(crate) async fn extension_heartbeat(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(payload): Json<ExtensionHeartbeatRequest>,
) -> Result<Json<ExtensionHeartbeatResponse>, (StatusCode, String)> {
    let origin = extension_origin_from_headers(&headers).ok_or_else(|| {
        record_app_runtime_event("api", "extension-heartbeat-missing-origin", None);
        (
            StatusCode::BAD_REQUEST,
            "missing extension origin".to_string(),
        )
    })?;

    state
        .record_extension_heartbeat(
            &origin,
            payload.client_id.as_deref(),
            payload.normal_window_count,
            &payload.preload_window_hwnds,
        )
        .map_err(|error| (StatusCode::FORBIDDEN, error.to_string()))?;
    let active_lease_count =
        state.active_extension_heartbeat_count(crate::api::EXTENSION_HEARTBEAT_TTL);
    let active_normal_window_count =
        state.active_extension_normal_window_count(crate::api::EXTENSION_HEARTBEAT_TTL);
    record_app_runtime_event(
        "api",
        "extension-heartbeat",
        Some(format!(
            "{origin}::active={active_lease_count}::normalWindows={active_normal_window_count}"
        )),
    );

    Ok(Json(ExtensionHeartbeatResponse {
        ok: true,
        active_lease_count,
        active_normal_window_count,
    }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegisterExtensionResponse {
    ok: bool,
    allowed_origin: String,
    allowed_origins: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExtensionHeartbeatRequest {
    #[serde(default)]
    client_id: Option<String>,
    #[serde(default)]
    normal_window_count: Option<usize>,
    #[serde(default)]
    preload_window_hwnds: Vec<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExtensionHeartbeatResponse {
    ok: bool,
    active_lease_count: usize,
    active_normal_window_count: usize,
}
