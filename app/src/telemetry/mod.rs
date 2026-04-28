mod hardware;
mod performance;
mod types;
mod utils;

pub use performance::{is_google_chrome_browser_process, SystemSnapshotter};
pub use types::{
    ChromePerformanceSnapshot, CpuHardwareSnapshot, DiskHardwareSnapshot, GpuHardwareSnapshot,
    HardwareSnapshot, MemoryHardwareSnapshot, MemoryModuleSnapshot, PerformanceSnapshot,
    SystemPerformanceSnapshot, SystemSnapshot,
};
use types::{
    ChromeProcessSnapshot, GpuEnginePerformanceRow, GpuMetrics, Win32DiskDriveRow,
    Win32PhysicalMemoryRow, Win32ProcessorRow, Win32VideoControllerRow,
};
use utils::{chrono_like_now, memory_type_label, normalize_gpu_percent, ratio, wmi_connection};
