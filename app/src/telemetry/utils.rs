use anyhow::Result;
use chrono::Utc;
use wmi::WMIConnection;

pub(super) fn wmi_connection() -> Result<WMIConnection> {
    Ok(WMIConnection::new()?)
}

pub(super) fn memory_type_label(value: u16) -> Option<String> {
    let label = match value {
        20 => "DDR",
        21 => "DDR2",
        24 => "DDR3",
        26 => "DDR4",
        34 => "DDR5",
        _ => return None,
    };

    Some(label.to_string())
}

pub(super) fn ratio(used: u64, total: u64) -> f64 {
    if total == 0 {
        return 0.0;
    }

    used as f64 / total as f64
}

pub(super) fn normalize_gpu_percent(value: f32) -> Option<f32> {
    if value <= 0.0 {
        return None;
    }

    Some(value.clamp(0.0, 100.0))
}

pub(super) fn chrono_like_now() -> String {
    Utc::now().to_rfc3339()
}
