use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::api::auth::is_authorized_debug_request;
use crate::api::origin::{normalize_debug_origin, normalize_extension_origin};
use crate::api::ApiState;

pub(super) async fn apply_extension_cors(
    State(state): State<ApiState>,
    request: Request,
    next: Next,
) -> Response {
    let request_method = request.method().clone();
    let request_path = request.uri().path().to_string();
    let request_origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let debug_authorized = is_authorized_debug_request(&state, request.headers());
    let allowed_origin = request_origin
        .as_deref()
        .and_then(|origin| authorized_cors_origin(&state, &request_path, origin, debug_authorized));

    if request_method == Method::OPTIONS {
        return build_preflight_cors_response(allowed_origin.as_deref(), debug_authorized);
    }

    let mut response = next.run(request).await;

    if let Some(allowed_origin) = allowed_origin.as_deref() {
        append_extension_cors_headers(response.headers_mut(), allowed_origin);
    }

    response
}

fn authorized_cors_origin(
    state: &ApiState,
    request_path: &str,
    origin: &str,
    debug_authorized: bool,
) -> Option<String> {
    if request_path == "/api/v1/extension/register" {
        return normalize_extension_origin(origin);
    }

    if debug_authorized {
        return normalize_debug_origin(origin);
    }

    state
        .is_authorized_extension_origin(origin)
        .then(|| origin.to_string())
}

fn build_preflight_cors_response(allowed_origin: Option<&str>, debug_authorized: bool) -> Response {
    let Some(allowed_origin) = allowed_origin else {
        return StatusCode::FORBIDDEN.into_response();
    };

    let mut response = StatusCode::NO_CONTENT.into_response();
    append_extension_cors_headers(response.headers_mut(), allowed_origin);
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static(if debug_authorized {
            "content-type, x-zlw-debug-token, x-zlw-extension-origin"
        } else {
            "content-type, x-zlw-extension-origin"
        }),
    );
    response.headers_mut().insert(
        header::HeaderName::from_static("access-control-allow-private-network"),
        HeaderValue::from_static("true"),
    );
    response
}

fn append_extension_cors_headers(headers: &mut HeaderMap, allowed_origin: &str) {
    if let Ok(allowed_origin_value) = HeaderValue::from_str(allowed_origin) {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, allowed_origin_value);
    }

    headers.insert(
        header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
        HeaderValue::from_static("true"),
    );
    headers.insert(header::VARY, HeaderValue::from_static("Origin"));
}
