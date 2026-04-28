use anyhow::Result;
use sysinfo::System;

use super::*;

impl HardwareSnapshot {
    pub(super) fn collect(system: &System) -> Result<Self> {
        let connection = wmi_connection()?;
        let cpu_rows: Vec<Win32ProcessorRow> =
            connection.raw_query("SELECT * FROM Win32_Processor")?;
        let memory_rows: Vec<Win32PhysicalMemoryRow> =
            connection.raw_query("SELECT * FROM Win32_PhysicalMemory")?;
        let gpu_rows: Vec<Win32VideoControllerRow> = connection
            .raw_query("SELECT * FROM Win32_VideoController")
            .unwrap_or_default();
        let disk_rows: Vec<Win32DiskDriveRow> = connection
            .raw_query("SELECT * FROM Win32_DiskDrive")
            .unwrap_or_default();

        let cpu_row = cpu_rows.into_iter().next().unwrap_or_default();
        let memory_modules = memory_rows
            .iter()
            .map(MemoryModuleSnapshot::from)
            .collect::<Vec<_>>();
        let total_installed_bytes = memory_rows
            .iter()
            .filter_map(|row| row.capacity)
            .sum::<u64>()
            .max(system.total_memory());

        Ok(Self {
            cpu: CpuHardwareSnapshot {
                model: cpu_row.name.unwrap_or_else(|| "Unknown CPU".to_string()),
                manufacturer: cpu_row.manufacturer,
                physical_cores: cpu_row.number_of_cores,
                logical_cores: cpu_row.number_of_logical_processors,
                max_clock_mhz: cpu_row.max_clock_speed,
                current_clock_mhz: cpu_row.current_clock_speed,
            },
            memory: MemoryHardwareSnapshot {
                total_installed_bytes,
                module_count: memory_modules.len() as u32,
                modules: memory_modules,
            },
            gpus: gpu_rows
                .into_iter()
                .map(GpuHardwareSnapshot::from)
                .collect(),
            disks: disk_rows
                .into_iter()
                .map(DiskHardwareSnapshot::from)
                .collect(),
        })
    }
}

impl From<&Win32PhysicalMemoryRow> for MemoryModuleSnapshot {
    fn from(row: &Win32PhysicalMemoryRow) -> Self {
        Self {
            capacity_bytes: row.capacity,
            speed_mhz: row.speed,
            configured_clock_mhz: row.configured_clock_speed,
            memory_type: row.smbios_memory_type.and_then(memory_type_label),
            manufacturer: row.manufacturer.clone(),
            part_number: row
                .part_number
                .clone()
                .map(|value| value.trim().to_string()),
            device_locator: row.device_locator.clone(),
            timing_profile: None,
        }
    }
}

impl From<Win32VideoControllerRow> for GpuHardwareSnapshot {
    fn from(row: Win32VideoControllerRow) -> Self {
        Self {
            name: row.name.unwrap_or_else(|| "Unknown GPU".to_string()),
            adapter_ram_bytes: row.adapter_ram,
            driver_version: row.driver_version,
            video_processor: row.video_processor,
        }
    }
}

impl From<Win32DiskDriveRow> for DiskHardwareSnapshot {
    fn from(row: Win32DiskDriveRow) -> Self {
        Self {
            model: row.model,
            size_bytes: row.size,
            media_type: row.media_type,
            interface_type: row.interface_type,
        }
    }
}
