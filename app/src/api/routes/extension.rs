use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Serialize;

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
    }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegisterExtensionResponse {
    ok: bool,
    allowed_origin: String,
}
