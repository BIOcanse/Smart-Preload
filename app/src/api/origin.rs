use axum::http::{header, HeaderMap};

use crate::api::{EXTENSION_LOCALE_HEADER, EXTENSION_ORIGIN_HEADER};

const LOCAL_API_PORT: u16 = 45831;

/// Rejects any request whose `Host` header is not the loopback authority this
/// API is actually served on.
///
/// This is the DNS-rebinding gate. Without it, a page loaded from
/// `http://attacker.test:45831` whose DNS is then re-pointed at 127.0.0.1
/// becomes *same-origin* with this API. Same-origin means: no preflight, so it
/// can set `x-zlw-extension-origin` freely (the extension id is public), no
/// `Origin` header is sent on GET, and the response body is readable without
/// any CORS header. Every other check in this module is bypassed.
///
/// `Host` closes it because it is a forbidden header name — page script cannot
/// override it, and the browser fills it from the URL the page was loaded from,
/// so a rebound page still sends `Host: attacker.test:45831`.
pub(crate) fn is_local_api_host(headers: &HeaderMap) -> bool {
    headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .is_some_and(is_local_api_authority)
}

fn is_local_api_authority(host: &str) -> bool {
    let trimmed_host = host.trim();

    let (hostname, port) = match trimmed_host.rsplit_once(':') {
        Some((hostname, port_text)) => match port_text.parse::<u16>() {
            Ok(port) => (hostname, Some(port)),
            Err(_) => return false,
        },
        None => (trimmed_host, None),
    };

    if port.is_some_and(|port| port != LOCAL_API_PORT) {
        return false;
    }

    matches!(hostname, "127.0.0.1" | "localhost")
}

/// 取请求方声明的界面语言。只喂给配对弹窗选文案，不参与任何安全判定。
///
/// 这里不做合法性校验 —— 归一化与回落在 `pairing::text::normalize_locale` 里做，
/// 那样「什么算合法语言」只有一处定义。这里只负责把头读成字符串。
pub(crate) fn extension_locale_from_headers(headers: &HeaderMap) -> String {
    headers
        .get(EXTENSION_LOCALE_HEADER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string()
}

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

#[cfg(test)]
mod host_tests {
    use super::*;

    fn headers_with_host(host: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, host.parse().expect("valid host header"));
        headers
    }

    #[test]
    fn accepts_the_authority_the_extension_actually_uses() {
        // extension/background/shared/native-app/request/common.js:5
        assert!(is_local_api_host(&headers_with_host("127.0.0.1:45831")));
        assert!(is_local_api_host(&headers_with_host("localhost:45831")));
    }

    #[test]
    fn rejects_rebound_attacker_authority() {
        // The whole point: a rebound page is same-origin and can forge
        // x-zlw-extension-origin, but it cannot forge Host.
        assert!(!is_local_api_host(&headers_with_host(
            "attacker.test:45831"
        )));
        assert!(!is_local_api_host(&headers_with_host("evil.example:45831")));
        assert!(!is_local_api_host(&headers_with_host(
            "127.0.0.1.attacker.test:45831"
        )));
        assert!(!is_local_api_host(&headers_with_host(
            "attacker.test:45831:45831"
        )));
    }

    #[test]
    fn rejects_wrong_port_and_missing_host() {
        assert!(!is_local_api_host(&headers_with_host("127.0.0.1:8080")));
        assert!(!is_local_api_host(&headers_with_host("localhost:1234")));
        assert!(!is_local_api_host(&HeaderMap::new()));
    }

    #[test]
    fn rejects_unparsable_port() {
        assert!(!is_local_api_host(&headers_with_host("127.0.0.1:notaport")));
        assert!(!is_local_api_host(&headers_with_host("127.0.0.1:")));
    }

    #[test]
    fn accepts_portless_loopback_host() {
        // HTTP/1.1 clients normally include the non-default port, but a
        // portless Host is still unambiguously loopback.
        assert!(is_local_api_host(&headers_with_host("127.0.0.1")));
        assert!(is_local_api_host(&headers_with_host("localhost")));
        assert!(!is_local_api_host(&headers_with_host("attacker.test")));
    }
}
