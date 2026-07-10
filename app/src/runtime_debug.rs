use std::collections::VecDeque;
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

static APP_RUNTIME_EVENTS: OnceLock<Arc<Mutex<VecDeque<AppRuntimeEvent>>>> = OnceLock::new();
static APP_RUNTIME_EVENT_WRITER: OnceLock<Mutex<Option<RuntimeEventWriterRuntime>>> =
    OnceLock::new();
static DROPPED_RUNTIME_EVENT_COUNT: AtomicU64 = AtomicU64::new(0);

const MAX_APP_RUNTIME_EVENTS: usize = 512;
const MAX_APP_RUNTIME_EVENT_LOG_LINES: usize = 1024;
const MAX_APP_RUNTIME_EVENT_LOG_BYTES: u64 = 2 * 1024 * 1024;
const APP_RUNTIME_EVENT_CHANNEL_CAPACITY: usize = 1024;
const APP_RUNTIME_EVENT_LOG_FILE_NAME: &str = "app-runtime-events.jsonl";
const APP_RUNTIME_EVENT_LOG_BACKUP_FILE_NAME: &str = "app-runtime-events.1.jsonl";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRuntimeEvent {
    pub recorded_at_ms: u64,
    pub scope: String,
    pub event_name: String,
    pub detail: Option<String>,
}

enum WriterCommand {
    Event(AppRuntimeEvent),
    Flush(mpsc::Sender<()>),
    Shutdown(mpsc::Sender<()>),
}

struct RuntimeEventWriterRuntime {
    sender: SyncSender<WriterCommand>,
    join_handle: JoinHandle<()>,
}

struct RuntimeEventFileWriter {
    log_path: PathBuf,
    backup_path: PathBuf,
    file: File,
    line_count: usize,
    byte_count: u64,
    max_lines: usize,
    max_bytes: u64,
}

impl RuntimeEventFileWriter {
    fn open(log_path: PathBuf, max_lines: usize, max_bytes: u64) -> anyhow::Result<Self> {
        if let Some(parent_dir) = log_path.parent() {
            fs::create_dir_all(parent_dir)?;
        }

        let backup_path = backup_log_path(&log_path);
        compact_log_file_if_needed(&log_path, max_lines, max_bytes)?;
        compact_log_file_if_needed(&backup_path, max_lines, max_bytes)?;
        let line_count = count_nonempty_lines(&log_path)?;
        let byte_count = fs::metadata(&log_path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)?;

        Ok(Self {
            log_path,
            backup_path,
            file,
            line_count,
            byte_count,
            max_lines,
            max_bytes,
        })
    }

    fn write_event(&mut self, event: &AppRuntimeEvent) -> anyhow::Result<()> {
        let mut encoded = serde_json::to_vec(event)?;
        encoded.push(b'\n');

        if self.line_count >= self.max_lines
            || self.byte_count.saturating_add(encoded.len() as u64) > self.max_bytes
        {
            self.rotate()?;
        }

        self.file.write_all(&encoded)?;
        self.file.flush()?;
        self.line_count += 1;
        self.byte_count = self.byte_count.saturating_add(encoded.len() as u64);
        Ok(())
    }

    fn flush(&mut self) {
        let _ = self.file.flush();
    }

    fn rotate(&mut self) -> anyhow::Result<()> {
        self.file.flush()?;

        if self.backup_path.exists() {
            fs::remove_file(&self.backup_path)?;
        }

        if self.log_path.exists() {
            fs::rename(&self.log_path, &self.backup_path)?;
        }

        self.file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&self.log_path)?;
        self.line_count = 0;
        self.byte_count = 0;
        Ok(())
    }
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

    enqueue_runtime_event(event);
}

pub fn snapshot_app_runtime_events(limit: usize) -> Vec<AppRuntimeEvent> {
    let normalized_limit = limit.max(1);
    flush_app_runtime_events(Duration::from_millis(500));

    read_runtime_events_from_files(normalized_limit)
        .filter(|events| !events.is_empty())
        .unwrap_or_else(|| snapshot_memory_events(normalized_limit))
}

pub fn shutdown_app_runtime_event_writer() {
    let Some(runtime_slot) = APP_RUNTIME_EVENT_WRITER.get() else {
        return;
    };
    let runtime = runtime_slot
        .lock()
        .ok()
        .and_then(|mut runtime| runtime.take());
    let Some(runtime) = runtime else {
        return;
    };
    let (ack_tx, ack_rx) = mpsc::channel();
    if runtime.sender.send(WriterCommand::Shutdown(ack_tx)).is_ok() {
        let _ = ack_rx.recv_timeout(Duration::from_secs(2));
    }
    let _ = runtime.join_handle.join();
}

fn enqueue_runtime_event(event: AppRuntimeEvent) {
    let Some(sender) = runtime_event_writer_sender() else {
        DROPPED_RUNTIME_EVENT_COUNT.fetch_add(1, Ordering::Relaxed);
        return;
    };

    match sender.try_send(WriterCommand::Event(event)) {
        Ok(()) => {}
        Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {
            DROPPED_RUNTIME_EVENT_COUNT.fetch_add(1, Ordering::Relaxed);
        }
    }
}

fn runtime_event_writer_sender() -> Option<SyncSender<WriterCommand>> {
    let runtime_slot = APP_RUNTIME_EVENT_WRITER.get_or_init(|| Mutex::new(None));
    let mut runtime = runtime_slot.lock().ok()?;

    if runtime
        .as_ref()
        .is_some_and(|existing| existing.join_handle.is_finished())
    {
        if let Some(finished) = runtime.take() {
            let _ = finished.join_handle.join();
        }
    }

    if let Some(existing) = runtime.as_ref() {
        return Some(existing.sender.clone());
    }

    let log_path = runtime_event_log_path().ok()?;
    let (sender, receiver) = mpsc::sync_channel(APP_RUNTIME_EVENT_CHANNEL_CAPACITY);
    let join_handle = thread::Builder::new()
        .name("zlw-runtime-log".to_string())
        .spawn(move || run_runtime_event_writer(log_path, receiver))
        .ok()?;
    *runtime = Some(RuntimeEventWriterRuntime {
        sender: sender.clone(),
        join_handle,
    });
    Some(sender)
}

fn run_runtime_event_writer(log_path: PathBuf, receiver: Receiver<WriterCommand>) {
    let Ok(mut writer) = RuntimeEventFileWriter::open(
        log_path,
        MAX_APP_RUNTIME_EVENT_LOG_LINES,
        MAX_APP_RUNTIME_EVENT_LOG_BYTES,
    ) else {
        return;
    };

    while let Ok(command) = receiver.recv() {
        match command {
            WriterCommand::Event(event) => {
                let _ = writer.write_event(&event);
            }
            WriterCommand::Flush(ack_tx) => {
                writer.flush();
                let _ = ack_tx.send(());
            }
            WriterCommand::Shutdown(ack_tx) => {
                writer.flush();
                let _ = ack_tx.send(());
                break;
            }
        }
    }
}

fn flush_app_runtime_events(timeout: Duration) {
    let Some(runtime_slot) = APP_RUNTIME_EVENT_WRITER.get() else {
        return;
    };
    let sender = runtime_slot
        .lock()
        .ok()
        .and_then(|runtime| runtime.as_ref().map(|runtime| runtime.sender.clone()));
    let Some(sender) = sender else {
        return;
    };
    let (ack_tx, ack_rx) = mpsc::channel();

    if sender.send(WriterCommand::Flush(ack_tx)).is_ok() {
        let _ = ack_rx.recv_timeout(timeout);
    }
}

fn runtime_events() -> Arc<Mutex<VecDeque<AppRuntimeEvent>>> {
    APP_RUNTIME_EVENTS
        .get_or_init(|| Arc::new(Mutex::new(VecDeque::new())))
        .clone()
}

fn snapshot_memory_events(limit: usize) -> Vec<AppRuntimeEvent> {
    runtime_events()
        .lock()
        .map(|events| {
            let skip = events.len().saturating_sub(limit);
            events.iter().skip(skip).cloned().collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn read_runtime_events_from_files(limit: usize) -> Option<Vec<AppRuntimeEvent>> {
    let log_path = runtime_event_log_path().ok()?;
    let mut events = VecDeque::with_capacity(limit);

    read_runtime_events_from_file(&backup_log_path(&log_path), limit, &mut events);
    read_runtime_events_from_file(&log_path, limit, &mut events);
    Some(events.into_iter().collect())
}

fn read_runtime_events_from_file(
    path: &Path,
    limit: usize,
    events: &mut VecDeque<AppRuntimeEvent>,
) {
    let Ok(file) = File::open(path) else {
        return;
    };

    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let Ok(event) = serde_json::from_str::<AppRuntimeEvent>(&line) else {
            continue;
        };
        events.push_back(event);

        while events.len() > limit {
            events.pop_front();
        }
    }
}

fn count_nonempty_lines(path: &Path) -> anyhow::Result<usize> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(error.into()),
    };

    Ok(BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter(|line| !line.trim().is_empty())
        .count())
}

fn compact_log_file_if_needed(path: &Path, max_lines: usize, max_bytes: u64) -> anyhow::Result<()> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    let line_count = count_nonempty_lines(path)?;

    if line_count <= max_lines && metadata.len() <= max_bytes {
        return Ok(());
    }

    let file = File::open(path)?;
    let mut retained = VecDeque::new();
    let mut retained_bytes = 0_u64;

    for line in BufReader::new(file).lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }

        retained_bytes = retained_bytes.saturating_add(line.len() as u64 + 1);
        retained.push_back(line);

        while retained.len() > max_lines || retained_bytes > max_bytes {
            let Some(removed) = retained.pop_front() else {
                break;
            };
            retained_bytes = retained_bytes.saturating_sub(removed.len() as u64 + 1);
        }
    }

    let mut file = OpenOptions::new().write(true).truncate(true).open(path)?;
    for line in retained {
        file.write_all(line.as_bytes())?;
        file.write_all(b"\n")?;
    }
    file.flush()?;
    Ok(())
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

fn backup_log_path(log_path: &Path) -> PathBuf {
    log_path.with_file_name(APP_RUNTIME_EVENT_LOG_BACKUP_FILE_NAME)
}

fn current_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(sequence: u64) -> AppRuntimeEvent {
        AppRuntimeEvent {
            recorded_at_ms: sequence,
            scope: "test".to_string(),
            event_name: format!("event-{sequence}"),
            detail: None,
        }
    }

    #[test]
    fn file_writer_rotates_without_rewriting_the_active_file_per_event() {
        let test_dir = env::temp_dir().join(format!(
            "smart-preload-runtime-log-test-{}-{}",
            std::process::id(),
            current_epoch_ms()
        ));
        let log_path = test_dir.join(APP_RUNTIME_EVENT_LOG_FILE_NAME);
        let mut writer = RuntimeEventFileWriter::open(log_path.clone(), 3, 64 * 1024)
            .expect("test writer should open");

        for sequence in 0..4 {
            writer
                .write_event(&event(sequence))
                .expect("test event should be written");
        }

        assert_eq!(count_nonempty_lines(&log_path).unwrap(), 1);
        assert_eq!(
            count_nonempty_lines(&backup_log_path(&log_path)).unwrap(),
            3
        );

        let mut events = VecDeque::new();
        read_runtime_events_from_file(&backup_log_path(&log_path), 10, &mut events);
        read_runtime_events_from_file(&log_path, 10, &mut events);
        assert_eq!(events.len(), 4);
        assert_eq!(events.back().map(|value| value.recorded_at_ms), Some(3));

        drop(writer);
        let _ = fs::remove_dir_all(test_dir);
    }

    #[test]
    fn startup_compaction_keeps_only_the_bounded_tail() {
        let test_dir = env::temp_dir().join(format!(
            "smart-preload-runtime-log-compact-test-{}-{}",
            std::process::id(),
            current_epoch_ms()
        ));
        fs::create_dir_all(&test_dir).unwrap();
        let log_path = test_dir.join(APP_RUNTIME_EVENT_LOG_FILE_NAME);
        let mut file = File::create(&log_path).unwrap();

        for sequence in 0..10 {
            serde_json::to_writer(&mut file, &event(sequence)).unwrap();
            file.write_all(b"\n").unwrap();
        }
        drop(file);

        compact_log_file_if_needed(&log_path, 3, 64 * 1024).unwrap();
        assert_eq!(count_nonempty_lines(&log_path).unwrap(), 3);

        let mut events = VecDeque::new();
        read_runtime_events_from_file(&log_path, 10, &mut events);
        assert_eq!(events.front().map(|value| value.recorded_at_ms), Some(7));
        assert_eq!(events.back().map(|value| value.recorded_at_ms), Some(9));

        let _ = fs::remove_dir_all(test_dir);
    }
}
