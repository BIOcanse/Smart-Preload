use std::collections::HashSet;

use anyhow::Result;
use regex::Regex;
use sysinfo::{Process, System};

use super::*;

pub struct SystemSnapshotter {
    system: System,
    hardware: HardwareSnapshot,
    gpu_pid_pattern: Regex,
}

impl SystemSnapshotter {
    pub fn new() -> Result<Self> {
        let mut system = System::new_all();
        system.refresh_all();

        Ok(Self {
            hardware: HardwareSnapshot::collect(&system)?,
            system,
            gpu_pid_pattern: Regex::new(r"pid_(\\d+)")?,
        })
    }

    pub fn collect_snapshot(&mut self) -> Result<SystemSnapshot> {
        self.system.refresh_all();

        let chrome_processes = self.chrome_processes();
        let chrome_pids: HashSet<u32> =
            chrome_processes.iter().map(|process| process.pid).collect();
        let gpu_metrics =
            GpuMetrics::collect(&chrome_pids, &self.gpu_pid_pattern).unwrap_or_default();

        let total_memory_bytes = self.system.total_memory();
        let available_memory_bytes = self.system.available_memory();
        let used_memory_bytes = total_memory_bytes.saturating_sub(available_memory_bytes);
        let chrome_memory_bytes = chrome_processes
            .iter()
            .map(|process| process.memory_bytes)
            .sum::<u64>();
        let chrome_cpu_usage_percent = chrome_processes
            .iter()
            .map(|process| process.cpu_usage_percent)
            .sum::<f32>();

        Ok(SystemSnapshot {
            generated_at: chrono_like_now(),
            hardware: self.hardware.clone(),
            performance: PerformanceSnapshot {
                system: SystemPerformanceSnapshot {
                    cpu_usage_percent: self.system.global_cpu_usage(),
                    memory_usage_ratio: ratio(used_memory_bytes, total_memory_bytes),
                    used_memory_bytes,
                    available_memory_bytes,
                    total_memory_bytes,
                    gpu_usage_percent: gpu_metrics.total_gpu_usage_percent,
                },
                chrome: ChromePerformanceSnapshot {
                    process_count: chrome_processes.len() as u32,
                    cpu_usage_percent: chrome_cpu_usage_percent,
                    cpu_core_usage_percent: None,
                    memory_bytes: chrome_memory_bytes,
                    gpu_usage_percent: gpu_metrics.chrome_gpu_usage_percent,
                },
            },
        })
    }

    fn chrome_processes(&self) -> Vec<ChromeProcessSnapshot> {
        self.system
            .processes()
            .values()
            .filter_map(|process| {
                if !is_google_chrome_process(process) {
                    return None;
                }

                Some(ChromeProcessSnapshot {
                    pid: process.pid().as_u32(),
                    cpu_usage_percent: process.cpu_usage(),
                    memory_bytes: process.memory(),
                })
            })
            .collect()
    }
}

pub fn is_google_chrome_process(process: &Process) -> bool {
    let process_name = process.name().to_string_lossy().to_ascii_lowercase();

    if process_name != "chrome.exe" && process_name != "chrome" {
        return false;
    }

    let Some(executable_path) = process.exe() else {
        return true;
    };

    let executable_path = executable_path.to_string_lossy().to_ascii_lowercase();
    executable_path.contains("\\google\\chrome\\")
        || executable_path.contains("\\google\\chrome beta\\")
        || executable_path.contains("\\google\\chrome sxs\\")
}

pub fn is_google_chrome_browser_process(process: &Process) -> bool {
    if !is_google_chrome_process(process) {
        return false;
    }

    !chrome_command_line(process).contains("--type=")
}

fn chrome_command_line(process: &Process) -> String {
    process
        .cmd()
        .iter()
        .map(|value| value.to_string_lossy())
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

impl GpuMetrics {
    fn collect(chrome_pids: &HashSet<u32>, pid_pattern: &Regex) -> Result<Self> {
        let connection = wmi_connection()?;
        let rows: Vec<GpuEnginePerformanceRow> = connection
            .raw_query(
                "SELECT Name, UtilizationPercentage \
                 FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine",
            )
            .unwrap_or_default();
        let mut total = 0.0_f32;
        let mut chrome = 0.0_f32;

        for row in rows {
            let utilization = row.utilization_percentage.unwrap_or(0.0);

            if utilization <= 0.0 {
                continue;
            }

            total += utilization;

            if let Some(name) = row.name {
                if let Some(captures) = pid_pattern.captures(&name) {
                    let pid = captures
                        .get(1)
                        .and_then(|value| value.as_str().parse::<u32>().ok());

                    if pid.is_some_and(|value| chrome_pids.contains(&value)) {
                        chrome += utilization;
                    }
                }
            }
        }

        Ok(Self {
            total_gpu_usage_percent: normalize_gpu_percent(total),
            chrome_gpu_usage_percent: normalize_gpu_percent(chrome),
        })
    }
}
