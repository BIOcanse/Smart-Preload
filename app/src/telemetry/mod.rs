mod activity;
mod hardware;
mod performance;
mod sampler;
mod types;
mod utils;

pub use activity::ActivitySnapshot;
pub use performance::{
    is_google_chrome_browser_process, supported_browser_process_info, SupportedBrowserProcessInfo,
    SystemSnapshotter,
};
pub use sampler::{SystemProcessSampler, PROCESS_SAMPLE_MAX_AGE};
pub use types::{
    ChromePerformanceSnapshot, CpuHardwareSnapshot, DiskHardwareSnapshot,
    GpuDedicatedMemoryPerformanceSnapshot, GpuHardwareSnapshot, HardwareSnapshot,
    MemoryHardwareSnapshot, MemoryModuleSnapshot, PerformanceSnapshot, SystemPerformanceSnapshot,
    SystemSnapshot,
};
use types::{
    ChromeProcessSnapshot, GpuAdapterMemoryPerformanceRow, GpuEnginePerformanceRow, GpuMetrics,
    Win32DiskDriveRow, Win32PhysicalMemoryRow, Win32ProcessorRow, Win32VideoControllerRow,
};
use utils::{chrono_like_now, memory_type_label, normalize_gpu_percent, ratio, wmi_connection};
