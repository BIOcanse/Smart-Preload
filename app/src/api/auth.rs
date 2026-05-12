use axum::extract::{Request, State};
use axum::http::{HeaderMap, StatusCode};
use axum::middleware::Next;
use axum::response::Response;

use crate::api::origin::extension_origin_from_headers;
use crate::api::ApiState;
use crate::runtime_debug::record_app_runtime_event;

pub(super) async fn require_registered_extension_origin(
    State(state): State<ApiState>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let request_path = request.uri().path().to_string();

    if is_authorized_debug_request(&state, request.headers()) {
        return Ok(next.run(request).await);
    }

    let Some(origin) = extension_origin_from_headers(request.headers()) else {
        record_app_runtime_event("api", "request-denied-missing-origin", Some(request_path));
        return Err(StatusCode::FORBIDDEN);
    };

    if !state.is_authorized_extension_origin(&origin) {
        record_app_runtime_event(
            "api",
            "request-denied-origin-mismatch",
            Some(format!("{request_path}::{origin}")),
        );
        return Err(StatusCode::FORBIDDEN);
    }

    Ok(next.run(request).await)
}

pub(super) fn is_authorized_debug_request(state: &ApiState, headers: &HeaderMap) -> bool {
    headers
        .get("x-zlw-debug-token")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|token| state.is_authorized_debug_token(token))
}
