use std::collections::HashSet;
use std::env;

use anyhow::Result;
use regex::Regex;
use sysinfo::{Process, System};

use super::*;

#[derive(Debug, Clone)]
pub struct SupportedBrowserProcessInfo {
    pub pid: u32,
    pub process_name: String,
    pub executable_path: Option<String>,
    pub browser_kind: String,
}

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
                    gpu_dedicated_memory: gpu_metrics.dedicated_memory,
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
                if !is_supported_chromium_process(process) {
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

#[allow(dead_code)]
pub fn is_google_chrome_process(process: &Process) -> bool {
    is_supported_chromium_process(process)
}

pub fn is_google_chrome_browser_process(process: &Process) -> bool {
    is_supported_chromium_browser_process(process)
}

pub fn is_supported_chromium_process(process: &Process) -> bool {
    supported_browser_process_info(process).is_some()
}

pub fn is_supported_chromium_browser_process(process: &Process) -> bool {
    if supported_browser_process_info(process).is_none() {
        return false;
    }

    !chrome_command_line(process).contains("--type=")
}

pub fn supported_browser_process_info(process: &Process) -> Option<SupportedBrowserProcessInfo> {
    let process_name = process.name().to_string_lossy().to_ascii_lowercase();

    if !is_supported_browser_process_name(&process_name) {
        return None;
    }

    let executable_path = process.exe().map(|path| path.to_string_lossy().to_string());
    let executable_path_lower = executable_path
        .as_deref()
        .unwrap_or("")
        .to_ascii_lowercase();
    let command_line = chrome_command_line(process);

    if env::var_os("ZLW_DEBUG_ALLOW_ANY_CHROME").is_some() {
        return Some(SupportedBrowserProcessInfo {
            pid: process.pid().as_u32(),
            process_name: process.name().to_string_lossy().to_string(),
            executable_path,
            browser_kind: infer_browser_kind(&process_name, &executable_path_lower, &command_line),
        });
    }

    if executable_path_lower.is_empty() {
        return Some(SupportedBrowserProcessInfo {
            pid: process.pid().as_u32(),
            process_name: process.name().to_string_lossy().to_string(),
            executable_path,
            browser_kind: infer_browser_kind(&process_name, &executable_path_lower, &command_line),
        });
    }

    if !is_supported_browser_executable_path(&process_name, &executable_path_lower, &command_line) {
        return None;
    }

    Some(SupportedBrowserProcessInfo {
        pid: process.pid().as_u32(),
        process_name: process.name().to_string_lossy().to_string(),
        executable_path,
        browser_kind: infer_browser_kind(&process_name, &executable_path_lower, &command_line),
    })
}

fn is_supported_browser_process_name(process_name: &str) -> bool {
    matches!(
        process_name,
        "chrome.exe" | "chrome" | "msedge.exe" | "msedge"
    )
}

fn is_supported_browser_executable_path(
    process_name: &str,
    executable_path: &str,
    command_line: &str,
) -> bool {
    if process_name == "msedge.exe" || process_name == "msedge" {
        return executable_path.contains("\\microsoft\\edge\\");
    }

    executable_path.contains("\\google\\chrome\\")
        || executable_path.contains("\\google\\chrome beta\\")
        || executable_path.contains("\\google\\chrome sxs\\")
        || executable_path.contains("\\chrome for testing\\")
        || executable_path.contains("\\chromium\\")
        || executable_path.contains("\\ms-playwright\\chromium-")
        || executable_path.contains("\\chrome-win64\\chrome.exe")
        || command_line.contains("prod=google chrome for testing")
}

fn infer_browser_kind(process_name: &str, executable_path: &str, command_line: &str) -> String {
    if process_name == "msedge.exe"
        || process_name == "msedge"
        || executable_path.contains("\\microsoft\\edge\\")
    {
        return "edge".to_owned();
    }

    if executable_path.contains("\\google\\chrome sxs\\") {
        return "chrome-canary".to_owned();
    }

    if executable_path.contains("\\google\\chrome beta\\") {
        return "chrome-beta".to_owned();
    }

    if executable_path.contains("\\google\\chrome\\") {
        return "chrome".to_owned();
    }

    if executable_path.contains("\\chrome for testing\\")
        || executable_path.contains("\\ms-playwright\\chromium-")
        || executable_path.contains("\\chrome-win64\\chrome.exe")
        || command_line.contains("prod=google chrome for testing")
    {
        return "chrome-for-testing".to_owned();
    }

    if executable_path.contains("\\chromium\\") {
        return "chromium".to_owned();
    }

    "chromium-compatible".to_owned()
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
            dedicated_memory: collect_gpu_dedicated_memory(&connection),
        })
    }
}

fn collect_gpu_dedicated_memory(
    connection: &wmi::WMIConnection,
) -> Option<GpuDedicatedMemoryPerformanceSnapshot> {
    let rows: Vec<GpuAdapterMemoryPerformanceRow> = connection
        .raw_query(
            "SELECT DedicatedUsage, DedicatedLimit \
             FROM Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory",
        )
        .unwrap_or_default();
    let mut most_constrained: Option<GpuDedicatedMemoryPerformanceSnapshot> = None;

    for row in rows {
        let row_limit = row.dedicated_limit.unwrap_or(0);

        if row_limit == 0 {
            continue;
        }

        let used_bytes = row.dedicated_usage.unwrap_or(0).min(row_limit);
        let available_bytes = row_limit.saturating_sub(used_bytes);
        let snapshot = GpuDedicatedMemoryPerformanceSnapshot {
            used_bytes,
            limit_bytes: row_limit,
            available_bytes,
            usage_ratio: ratio(used_bytes, row_limit),
        };

        let should_replace = match most_constrained.as_ref() {
            None => true,
            Some(current) => {
                snapshot.usage_ratio > current.usage_ratio
                    || (snapshot.usage_ratio == current.usage_ratio
                        && snapshot.used_bytes > current.used_bytes)
            }
        };

        if should_replace {
            most_constrained = Some(snapshot);
        }
    }

    most_constrained
}
