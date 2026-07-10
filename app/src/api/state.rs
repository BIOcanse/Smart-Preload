use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::Result;

use crate::lifecycle::target_extension_origin_is_installed;
use crate::telemetry::{ActivitySnapshot, SystemProcessSampler, SystemSnapshot, SystemSnapshotter};
use tokio::sync::watch;

use super::origin::normalize_extension_origin;
use super::persistence::{
    load_allowed_extension_origins, load_debug_api_token, persist_allowed_extension_origins,
};

#[derive(Clone)]
pub struct ApiState {
    snapshotter: SystemSnapshotter,
    allowed_extension_origins: Arc<Mutex<BTreeSet<String>>>,
    extension_heartbeats: Arc<Mutex<BTreeMap<String, ExtensionHeartbeatLease>>>,
    debug_api_token: Arc<Mutex<Option<String>>>,
    host_shutdown_tx: watch::Sender<bool>,
}

#[derive(Clone)]
struct ExtensionHeartbeatLease {
    last_seen_at: Instant,
    normal_window_count: Option<usize>,
    preload_window_hwnds: BTreeSet<u64>,
}

impl ApiState {
    pub fn new(snapshotter: SystemSnapshotter, host_shutdown_tx: watch::Sender<bool>) -> Self {
        Self {
            snapshotter,
            allowed_extension_origins: Arc::new(Mutex::new(load_allowed_extension_origins())),
            extension_heartbeats: Arc::new(Mutex::new(BTreeMap::new())),
            debug_api_token: Arc::new(Mutex::new(load_debug_api_token())),
            host_shutdown_tx,
        }
    }

    pub(crate) fn snapshot(&self) -> Result<SystemSnapshot> {
        self.snapshotter.collect_snapshot()
    }

    pub(crate) fn activity_snapshot(&self) -> Result<ActivitySnapshot> {
        self.snapshotter.collect_activity_snapshot()
    }

    pub(crate) fn process_sampler(&self) -> SystemProcessSampler {
        self.snapshotter.process_sampler()
    }

    pub(crate) fn get_allowed_extension_origin(&self) -> Option<String> {
        self.allowed_extension_origins
            .lock()
            .ok()
            .and_then(|value| value.iter().next().cloned())
    }

    pub(crate) fn get_allowed_extension_origins(&self) -> Vec<String> {
        self.allowed_extension_origins
            .lock()
            .map(|value| value.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub(crate) fn register_extension_origin(&self, origin: &str) -> Result<bool> {
        let normalized_origin = normalize_extension_origin(origin)
            .ok_or_else(|| anyhow::anyhow!("invalid extension origin"))?;
        let mut guard = self
            .allowed_extension_origins
            .lock()
            .map_err(|_| anyhow::anyhow!("extension origin lock poisoned"))?;

        if guard.contains(&normalized_origin) {
            return Ok(true);
        }

        if !target_extension_origin_is_installed(&normalized_origin) {
            return Ok(false);
        }

        guard.insert(normalized_origin);
        persist_allowed_extension_origins(&guard)?;
        Ok(true)
    }

    pub(crate) fn record_extension_heartbeat(
        &self,
        origin: &str,
        client_id: Option<&str>,
        normal_window_count: Option<usize>,
        preload_window_hwnds: &[u64],
    ) -> Result<()> {
        let normalized_origin = normalize_extension_origin(origin)
            .ok_or_else(|| anyhow::anyhow!("invalid extension origin"))?;

        if !self.is_authorized_extension_origin(&normalized_origin) {
            return Err(anyhow::anyhow!("extension origin is not authorized"));
        }

        let mut guard = self
            .extension_heartbeats
            .lock()
            .map_err(|_| anyhow::anyhow!("extension heartbeat lock poisoned"))?;
        guard.insert(
            build_extension_heartbeat_key(&normalized_origin, client_id),
            ExtensionHeartbeatLease {
                last_seen_at: Instant::now(),
                normal_window_count,
                preload_window_hwnds: normalize_preload_window_hwnds(preload_window_hwnds),
            },
        );
        Ok(())
    }

    pub(crate) fn active_extension_heartbeat_count(&self, ttl: Duration) -> usize {
        self.prune_and_count_extension_heartbeats(ttl)
            .map(|(active_count, _normal_window_count, _window_report_count)| active_count)
            .unwrap_or(0)
    }

    pub(crate) fn active_extension_normal_window_count(&self, ttl: Duration) -> usize {
        self.prune_and_count_extension_heartbeats(ttl)
            .map(|(_active_count, normal_window_count, _window_report_count)| normal_window_count)
            .unwrap_or(0)
    }

    pub(crate) fn active_extension_window_report_count(&self, ttl: Duration) -> usize {
        self.prune_and_count_extension_heartbeats(ttl)
            .map(|(_active_count, _normal_window_count, window_report_count)| window_report_count)
            .unwrap_or(0)
    }

    fn prune_and_count_extension_heartbeats(&self, ttl: Duration) -> Option<(usize, usize, usize)> {
        let Ok(mut guard) = self.extension_heartbeats.lock() else {
            return None;
        };
        let now = Instant::now();

        let stale_keys: Vec<String> = guard
            .iter()
            .filter(|(_key, lease)| now.duration_since(lease.last_seen_at) > ttl)
            .map(|(key, _lease)| key.clone())
            .collect();
        let stale_hwnds: BTreeSet<u64> = stale_keys
            .iter()
            .filter_map(|key| guard.get(key))
            .flat_map(|lease| lease.preload_window_hwnds.iter().copied())
            .collect();

        for key in stale_keys {
            guard.remove(&key);
        }

        let active_count = guard.len();
        let window_report_count = guard
            .values()
            .filter(|lease| lease.normal_window_count.is_some())
            .count();
        let normal_window_count = guard
            .values()
            .map(|lease| lease.normal_window_count.unwrap_or(0))
            .sum();

        drop(guard);

        if !stale_hwnds.is_empty() {
            crate::window::close_tracked_hidden_windows_by_hwnds(
                &stale_hwnds.into_iter().collect::<Vec<_>>(),
                "extension-heartbeat-expired",
            );
        }

        Some((active_count, normal_window_count, window_report_count))
    }

    pub(super) fn is_authorized_extension_origin(&self, origin: &str) -> bool {
        let Some(normalized_origin) = normalize_extension_origin(origin) else {
            return false;
        };

        self.allowed_extension_origins
            .lock()
            .map(|allowed_origins| allowed_origins.contains(&normalized_origin))
            .unwrap_or(false)
    }

    pub(super) fn is_authorized_debug_token(&self, token: &str) -> bool {
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

    pub(crate) fn request_host_shutdown(&self) {
        let _ = self.host_shutdown_tx.send(true);
    }
}

fn build_extension_heartbeat_key(origin: &str, client_id: Option<&str>) -> String {
    format!(
        "{origin}::{}",
        normalize_heartbeat_client_id(client_id).unwrap_or_else(|| "default".to_string())
    )
}

fn normalize_heartbeat_client_id(client_id: Option<&str>) -> Option<String> {
    let value = client_id?.trim();

    if value.len() < 8 || value.len() > 128 {
        return None;
    }

    if !value.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-' | ':')
    }) {
        return None;
    }

    Some(value.to_string())
}

fn normalize_preload_window_hwnds(values: &[u64]) -> BTreeSet<u64> {
    values
        .iter()
        .copied()
        .filter(|value| *value > 0)
        .take(128)
        .collect()
}
