use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSnapshot {
    pub generated_at: String,
    pub hardware: HardwareSnapshot,
    pub performance: PerformanceSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareSnapshot {
    pub cpu: CpuHardwareSnapshot,
    pub memory: MemoryHardwareSnapshot,
    pub gpus: Vec<GpuHardwareSnapshot>,
    pub disks: Vec<DiskHardwareSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuHardwareSnapshot {
    pub model: String,
    pub manufacturer: Option<String>,
    pub physical_cores: Option<u32>,
    pub logical_cores: Option<u32>,
    pub max_clock_mhz: Option<u32>,
    pub current_clock_mhz: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryHardwareSnapshot {
    pub total_installed_bytes: u64,
    pub module_count: u32,
    pub modules: Vec<MemoryModuleSnapshot>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryModuleSnapshot {
    pub capacity_bytes: Option<u64>,
    pub speed_mhz: Option<u32>,
    pub configured_clock_mhz: Option<u32>,
    pub memory_type: Option<String>,
    pub manufacturer: Option<String>,
    pub part_number: Option<String>,
    pub device_locator: Option<String>,
    pub timing_profile: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuHardwareSnapshot {
    pub name: String,
    pub adapter_ram_bytes: Option<u64>,
    pub driver_version: Option<String>,
    pub video_processor: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskHardwareSnapshot {
    pub model: Option<String>,
    pub size_bytes: Option<u64>,
    pub media_type: Option<String>,
    pub interface_type: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceSnapshot {
    pub system: SystemPerformanceSnapshot,
    pub chrome: ChromePerformanceSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPerformanceSnapshot {
    pub cpu_usage_percent: f32,
    pub memory_usage_ratio: f64,
    pub used_memory_bytes: u64,
    pub available_memory_bytes: u64,
    pub total_memory_bytes: u64,
    pub gpu_usage_percent: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChromePerformanceSnapshot {
    pub process_count: u32,
    pub cpu_usage_percent: f32,
    pub cpu_core_usage_percent: Option<f32>,
    pub memory_bytes: u64,
    pub gpu_usage_percent: Option<f32>,
}

#[derive(Debug, Default)]
pub(super) struct GpuMetrics {
    pub total_gpu_usage_percent: Option<f32>,
    pub chrome_gpu_usage_percent: Option<f32>,
}

#[derive(Debug)]
pub(super) struct ChromeProcessSnapshot {
    pub pid: u32,
    pub cpu_usage_percent: f32,
    pub memory_bytes: u64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct Win32ProcessorRow {
    pub name: Option<String>,
    pub manufacturer: Option<String>,
    pub number_of_cores: Option<u32>,
    pub number_of_logical_processors: Option<u32>,
    pub max_clock_speed: Option<u32>,
    pub current_clock_speed: Option<u32>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct Win32PhysicalMemoryRow {
    pub capacity: Option<u64>,
    pub speed: Option<u32>,
    pub configured_clock_speed: Option<u32>,
    pub manufacturer: Option<String>,
    pub part_number: Option<String>,
    pub device_locator: Option<String>,
    pub smbios_memory_type: Option<u16>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct Win32VideoControllerRow {
    pub name: Option<String>,
    pub adapter_ram: Option<u64>,
    pub driver_version: Option<String>,
    pub video_processor: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct Win32DiskDriveRow {
    pub model: Option<String>,
    pub size: Option<u64>,
    pub media_type: Option<String>,
    pub interface_type: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct GpuEnginePerformanceRow {
    pub name: Option<String>,
    pub utilization_percentage: Option<f32>,
}
