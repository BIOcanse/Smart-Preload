use std::env;
use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use anyhow::Result;
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use tokio::net::TcpListener;
use tokio::sync::watch;

use crate::runtime_debug::record_app_runtime_event;
use crate::telemetry::{SystemSnapshot, SystemSnapshotter};

mod routes;
pub(crate) const EXTENSION_ORIGIN_HEADER: &str = "x-zlw-extension-origin";

#[derive(Clone)]
pub struct ApiState {
    snapshotter: Arc<Mutex<SystemSnapshotter>>,
    allowed_extension_origin: Arc<Mutex<Option<String>>>,
    debug_api_token: Arc<Mutex<Option<String>>>,
}

impl ApiState {
    pub fn new(snapshotter: Arc<Mutex<SystemSnapshotter>>) -> Self {
        Self {
            snapshotter,
            allowed_extension_origin: Arc::new(Mutex::new(load_allowed_extension_origin())),
            debug_api_token: Arc::new(Mutex::new(load_debug_api_token())),
        }
    }

    fn snapshot(&self) -> Result<SystemSnapshot> {
        let mut snapshotter = self
            .snapshotter
            .lock()
            .map_err(|_| anyhow::anyhow!("snapshotter lock poisoned"))?;
        snapshotter.collect_snapshot()
    }

    pub(crate) fn get_allowed_extension_origin(&self) -> Option<String> {
        self.allowed_extension_origin
            .lock()
            .ok()
            .and_then(|value| value.clone())
    }

    pub(crate) fn register_extension_origin(&self, origin: &str) -> Result<bool> {
        let normalized_origin = normalize_extension_origin(origin)
            .ok_or_else(|| anyhow::anyhow!("invalid extension origin"))?;
        let mut guard = self
            .allowed_extension_origin
            .lock()
            .map_err(|_| anyhow::anyhow!("extension origin lock poisoned"))?;

        match guard.as_deref() {
            Some(existing_origin) if existing_origin == normalized_origin => Ok(true),
            Some(_) => Ok(false),
            None => {
                persist_allowed_extension_origin(&normalized_origin)?;
                *guard = Some(normalized_origin);
                Ok(true)
            }
        }
    }

    fn is_authorized_extension_origin(&self, origin: &str) -> bool {
        let Some(normalized_origin) = normalize_extension_origin(origin) else {
            return false;
        };

        self.get_allowed_extension_origin()
            .as_deref()
            .map(|allowed_origin| allowed_origin == normalized_origin)
            .unwrap_or(false)
    }

    fn is_authorized_debug_token(&self, token: &str) -> bool {
        let provided = token.trim();
        if provided.is_empty() {
            return false;
        }

        self.debug_api_token
            .lock()
            .ok()
            .and_then(|value| value.clone())
            .map(|expected| expected == provided)
            .unwrap_or(false)
    }
}

pub fn spawn_server(state: ApiState, shutdown_rx: watch::Receiver<bool>) -> JoinHandle<()> {
    thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .thread_name("zlw-api")
            .build()
            .expect("failed to build tokio runtime");

        runtime.block_on(async move {
            if let Err(error) = run_server(state, shutdown_rx).await {
                tracing::error!("hardware API server failed: {error:?}");
            }
        });
    })
}

async fn run_server(state: ApiState, mut shutdown_rx: watch::Receiver<bool>) -> Result<()> {
    let protected_routes = Router::new()
        .route("/health", get(routes::health))
        .route("/api/v1/system/hardware", get(routes::system_hardware))
        .route(
            "/api/v1/system/performance",
            get(routes::system_performance),
        )
        .route("/api/v1/system/snapshot", get(routes::system_snapshot))
        .route("/api/v1/ai/status", get(routes::ai_status))
        .route("/api/v1/ai/progress", get(routes::ai_progress))
        .route("/api/v1/ai/models/install", post(routes::install_ai_model))
        .route(
            "/api/v1/ai/models/uninstall",
            post(routes::uninstall_ai_model),
        )
        .route("/api/v1/ai/infer", post(routes::invoke_ai_model))
        .route("/api/v1/windows/chrome", get(routes::list_chrome_windows))
        .route(
            "/api/v1/windows/hidden-monitor",
            get(routes::hidden_window_monitor),
        )
        .route(
            "/api/v1/windows/monitor-snapshot",
            get(routes::hidden_window_monitor),
        )
        .route(
            "/api/v1/windows/monitor-snapshot-read",
            post(routes::hidden_window_monitor_post),
        )
        .route("/api/v1/windows/hide", post(routes::hide_chrome_window))
        .route("/api/v1/windows/show", post(routes::show_chrome_window))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_registered_extension_origin,
        ));
    let shared_state = state.clone();
    let app = Router::new()
        .route(
            "/api/v1/extension/register",
            post(routes::register_extension),
        )
        .merge(protected_routes)
        .with_state(shared_state)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            apply_extension_cors,
        ));

    let address = SocketAddr::from(([127, 0, 0, 1], 45831));
    let listener = TcpListener::bind(address).await?;

    record_app_runtime_event("api", "server-listening", Some(format!("http://{address}")));
    tracing::info!("hardware API listening on http://{address}");

    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = shutdown_rx.changed().await;
        })
        .await?;

    record_app_runtime_event("api", "server-stopped", None);

    Ok(())
}

async fn require_registered_extension_origin(
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

async fn apply_extension_cors(
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

fn is_authorized_debug_request(state: &ApiState, headers: &HeaderMap) -> bool {
    headers
        .get("x-zlw-debug-token")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|token| state.is_authorized_debug_token(token))
}

pub(crate) fn extension_origin_from_headers(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::ORIGIN)
        .or_else(|| headers.get(EXTENSION_ORIGIN_HEADER))
        .and_then(|value| value.to_str().ok())
        .and_then(normalize_extension_origin)
}

fn normalize_extension_origin(origin: &str) -> Option<String> {
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

fn normalize_debug_origin(origin: &str) -> Option<String> {
    let trimmed_origin = origin.trim();

    if trimmed_origin.starts_with("http://127.0.0.1:")
        || trimmed_origin.starts_with("http://localhost:")
    {
        return Some(trimmed_origin.to_string());
    }

    None
}

fn load_allowed_extension_origin() -> Option<String> {
    let origin_path = allowed_extension_origin_path().ok()?;
    let origin = fs::read_to_string(origin_path).ok()?;
    normalize_extension_origin(&origin)
}

fn load_debug_api_token() -> Option<String> {
    let token_path = debug_api_token_path().ok()?;
    let token = fs::read_to_string(token_path).ok()?;
    let trimmed = token.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn persist_allowed_extension_origin(origin: &str) -> Result<()> {
    let origin_path = allowed_extension_origin_path()?;

    if let Some(parent_dir) = origin_path.parent() {
        fs::create_dir_all(parent_dir)?;
    }

    fs::write(origin_path, origin)?;
    Ok(())
}

fn allowed_extension_origin_path() -> Result<PathBuf> {
    let executable_path = env::current_exe()?;
    let executable_dir = executable_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("local app executable directory is not available"))?;
    Ok(executable_dir
        .join("portable")
        .join("allowed-extension-origin.txt"))
}

fn debug_api_token_path() -> Result<PathBuf> {
    let executable_path = env::current_exe()?;
    let executable_dir = executable_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("local app executable directory is not available"))?;
    Ok(executable_dir.join("portable").join("debug-api-token.txt"))
}
