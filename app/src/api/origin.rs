use axum::http::{header, HeaderMap};

use crate::api::EXTENSION_ORIGIN_HEADER;

pub(crate) fn extension_origin_from_headers(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::ORIGIN)
        .or_else(|| headers.get(EXTENSION_ORIGIN_HEADER))
        .and_then(|value| value.to_str().ok())
        .and_then(normalize_extension_origin)
}

pub(super) fn normalize_extension_origin(origin: &str) -> Option<String> {
    let trimmed_origin = origin.trim();

    if !trimmed_origin.starts_with("chrome-extension://") {
        return None;
    }

    let extension_id = trimmed_origin
        .trim_start_matches("chrome-extension://")
        .trim();

    if extension_id.len() != 32
        || !extension_id
            .chars()
            .all(|character| character.is_ascii_lowercase())
    {
        return None;
    }

    Some(format!("chrome-extension://{extension_id}"))
}

pub(super) fn normalize_debug_origin(origin: &str) -> Option<String> {
    let trimmed_origin = origin.trim();

    if trimmed_origin.starts_with("http://127.0.0.1:")
        || trimmed_origin.starts_with("http://localhost:")
    {
        return Some(trimmed_origin.to_string());
    }

    None
}
