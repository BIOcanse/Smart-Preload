use std::collections::VecDeque;
use std::env;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

static APP_RUNTIME_EVENTS: OnceLock<Arc<Mutex<VecDeque<AppRuntimeEvent>>>> = OnceLock::new();

const MAX_APP_RUNTIME_EVENTS: usize = 512;
const MAX_APP_RUNTIME_EVENT_LOG_LINES: usize = 1024;
const APP_RUNTIME_EVENT_LOG_FILE_NAME: &str = "app-runtime-events.jsonl";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRuntimeEvent {
    pub recorded_at_ms: u64,
    pub scope: String,
    pub event_name: String,
    pub detail: Option<String>,
}

pub fn record_app_runtime_event(scope: &str, event_name: &str, detail: Option<String>) {
    let event = AppRuntimeEvent {
        recorded_at_ms: current_epoch_ms(),
        scope: scope.to_string(),
        event_name: event_name.to_string(),
        detail,
    };

    if let Ok(mut events) = runtime_events().lock() {
        events.push_back(event.clone());

        while events.len() > MAX_APP_RUNTIME_EVENTS {
            events.pop_front();
        }
    }

    let _ = append_runtime_event_to_file(&event);
}

pub fn snapshot_app_runtime_events(limit: usize) -> Vec<AppRuntimeEvent> {
    let normalized_limit = limit.max(1);

    read_runtime_events_from_file(normalized_limit)
        .filter(|events| !events.is_empty())
        .unwrap_or_else(|| {
            runtime_events()
                .lock()
                .map(|events| {
                    let skip = events.len().saturating_sub(normalized_limit);
                    events.iter().skip(skip).cloned().collect::<Vec<_>>()
                })
                .unwrap_or_default()
        })
}

fn runtime_events() -> Arc<Mutex<VecDeque<AppRuntimeEvent>>> {
    APP_RUNTIME_EVENTS
        .get_or_init(|| Arc::new(Mutex::new(VecDeque::new())))
        .clone()
}

fn append_runtime_event_to_file(event: &AppRuntimeEvent) -> anyhow::Result<()> {
    let log_path = runtime_event_log_path()?;

    if let Some(parent_dir) = log_path.parent() {
        fs::create_dir_all(parent_dir)?;
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)?;
    serde_json::to_writer(&mut file, event)?;
    file.write_all(b"\n")?;
    trim_runtime_event_file_if_needed(&log_path)?;
    Ok(())
}

fn trim_runtime_event_file_if_needed(log_path: &PathBuf) -> anyhow::Result<()> {
    let contents = fs::read_to_string(log_path)?;
    let lines = contents
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>();

    if lines.len() <= MAX_APP_RUNTIME_EVENT_LOG_LINES {
        return Ok(());
    }

    let start = lines.len().saturating_sub(MAX_APP_RUNTIME_EVENT_LOG_LINES);
    let trimmed = lines[start..].join("\n");
    fs::write(log_path, format!("{trimmed}\n"))?;
    Ok(())
}

fn read_runtime_events_from_file(limit: usize) -> Option<Vec<AppRuntimeEvent>> {
    let log_path = runtime_event_log_path().ok()?;
    let contents = fs::read_to_string(log_path).ok()?;
    let mut events = contents
        .lines()
        .filter_map(|line| serde_json::from_str::<AppRuntimeEvent>(line).ok())
        .collect::<Vec<_>>();

    if events.len() > limit {
        let start = events.len().saturating_sub(limit);
        events = events.split_off(start);
    }

    Some(events)
}

fn runtime_event_log_path() -> anyhow::Result<PathBuf> {
    let executable_path = env::current_exe()?;
    let executable_dir = executable_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("local app executable directory is not available"))?;
    Ok(executable_dir
        .join("portable")
        .join(APP_RUNTIME_EVENT_LOG_FILE_NAME))
}

fn current_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}
