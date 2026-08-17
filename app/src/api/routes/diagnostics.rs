use std::fs;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::runtime_debug::record_app_runtime_event;

const MAX_DIAGNOSTIC_EVENTS_PER_REQUEST: usize = 256;
const MAX_SESSION_ID_LEN: usize = 80;
/// 单个会话日志的大小上限，超过就轮转到 `.1` 备份并从头开始。
///
/// 此前这条路径**没有任何大小上限、轮转或文件数上限** —— 只是
/// `OpenOptions::append(true)` 一直往下写。而同一个进程里的 `runtime_debug.rs`
/// 早就有 1024 行 / 2 MiB 的轮转（`MAX_APP_RUNTIME_EVENT_LOG_BYTES`），两条日志路径
/// 策略不一致。诊断开着的时候正是磁盘增长最快的时候。
const MAX_DIAGNOSTIC_LOG_BYTES: u64 = 4 * 1024 * 1024;

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

    rotate_diagnostics_log_if_oversized(&log_path)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;

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

/// 单备份轮转，与 `runtime_debug.rs` 的做法一致：超过上限就把当前文件改名为 `.1`，
/// 覆盖掉上一份备份。因此每个会话最多占用 2 × `MAX_DIAGNOSTIC_LOG_BYTES`。
fn rotate_diagnostics_log_if_oversized(log_path: &Path) -> std::io::Result<()> {
    let Ok(metadata) = fs::metadata(log_path) else {
        return Ok(());
    };

    if metadata.len() < MAX_DIAGNOSTIC_LOG_BYTES {
        return Ok(());
    }

    let backup_path = log_path.with_extension("1.jsonl");

    if backup_path.exists() {
        fs::remove_file(&backup_path)?;
    }

    fs::rename(log_path, &backup_path)
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
