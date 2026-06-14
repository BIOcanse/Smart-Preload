mod app_update;
mod diagnostics;
mod extension;
mod system;
mod windows;

pub(crate) use app_update::{app_update_status, request_app_update};
pub(crate) use diagnostics::append_diagnostics_log;
pub(crate) use extension::{extension_heartbeat, register_extension};
pub(crate) use system::{
    health, system_activity, system_hardware, system_performance, system_snapshot,
};
pub(crate) use windows::{
    hidden_window_monitor, hidden_window_monitor_post, hide_chrome_window, list_chrome_windows,
    show_chrome_window,
};
