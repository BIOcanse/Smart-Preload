use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use sysinfo::System;

pub const PROCESS_SAMPLE_MAX_AGE: Duration = Duration::from_millis(750);

#[derive(Clone)]
pub struct SystemProcessSampler {
    inner: Arc<Mutex<SystemProcessSamplerState>>,
}

struct SystemProcessSamplerState {
    system: System,
    refreshed_at: Instant,
    #[cfg(test)]
    refresh_count: u64,
}

impl SystemProcessSampler {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(SystemProcessSamplerState {
                system: System::new_all(),
                refreshed_at: Instant::now(),
                #[cfg(test)]
                refresh_count: 1,
            })),
        }
    }

    pub fn with_system<T>(&self, max_age: Duration, read: impl FnOnce(&System) -> T) -> Result<T> {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| anyhow!("system process sampler lock poisoned"))?;

        if state.refreshed_at.elapsed() >= max_age {
            state.system.refresh_all();
            state.refreshed_at = Instant::now();
            #[cfg(test)]
            {
                state.refresh_count += 1;
            }
        }

        Ok(read(&state.system))
    }

    #[cfg(test)]
    fn refresh_count(&self) -> u64 {
        self.inner
            .lock()
            .map(|state| state.refresh_count)
            .unwrap_or_default()
    }
}

impl Default for SystemProcessSampler {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reuses_a_fresh_system_snapshot_and_refreshes_after_expiry() {
        let sampler = SystemProcessSampler::new();
        let initial_refresh_count = sampler.refresh_count();

        sampler
            .with_system(Duration::from_secs(60), |_| ())
            .expect("fresh sample should be readable");
        sampler
            .with_system(Duration::from_secs(60), |_| ())
            .expect("fresh sample should be reusable");
        assert_eq!(sampler.refresh_count(), initial_refresh_count);

        sampler
            .with_system(Duration::ZERO, |_| ())
            .expect("expired sample should refresh");
        assert_eq!(sampler.refresh_count(), initial_refresh_count + 1);
    }
}
