use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::runtime_debug::record_app_runtime_event;

const MAX_DIAGNOSTIC_EVENTS_PER_REQUEST: usize = 256;
const MAX_SESSION_ID_LEN: usize = 80;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppendDiagnosticsLogRequest {
    session_id: String,
    #[serde(default)]
    final_flush: bool,
    #[serde(default)]
    events: Vec<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppendDiagnosticsLogResponse {
    ok: bool,
    path: String,
    written: usize,
}

pub(crate) async fn append_diagnostics_log(
    Json(request): Json<AppendDiagnosticsLogRequest>,
) -> Result<Json<AppendDiagnosticsLogResponse>, (StatusCode, String)> {
    let session_id = normalize_session_id(&request.session_id)
        .ok_or_else(|| (StatusCode::BAD_REQUEST, "invalid session id".to_string()))?;
    let log_path = diagnostics_log_path(&session_id)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

    if let Some(parent_dir) = log_path.parent() {
        std::fs::create_dir_all(parent_dir)
            .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    }

    let mut log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
    let mut written = 0;

    for event in request
        .events
        .iter()
        .take(MAX_DIAGNOSTIC_EVENTS_PER_REQUEST)
    {
        let line = json!({
            "receivedAt": chrono::Utc::now().to_rfc3339(),
            "finalFlush": request.final_flush,
            "event": event,
        });
        let serialized = serde_json::to_string(&line)
            .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;

        log_file
            .write_all(serialized.as_bytes())
            .and_then(|_| log_file.write_all(b"\n"))
            .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
        written += 1;
    }

    record_app_runtime_event(
        "diagnostics",
        "log-appended",
        Some(format!("{session_id}::{written}")),
    );

    Ok(Json(AppendDiagnosticsLogResponse {
        ok: true,
        path: log_path.to_string_lossy().to_string(),
        written,
    }))
}

fn diagnostics_log_path(session_id: &str) -> std::io::Result<PathBuf> {
    let executable_path = std::env::current_exe()?;
    let executable_dir = executable_path
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| std::io::Error::other("executable directory is not available"))?;

    Ok(executable_dir
        .join("portable")
        .join("logs")
        .join(format!("extension-{session_id}.jsonl")))
}

fn normalize_session_id(value: &str) -> Option<String> {
    let normalized = value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .take(MAX_SESSION_ID_LEN)
        .collect::<String>();

    (!normalized.is_empty()).then_some(normalized)
}
