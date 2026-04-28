mod ai;
mod extension;
mod system;
mod windows;

pub(crate) use ai::{
    ai_progress, ai_status, install_ai_model, invoke_ai_model, uninstall_ai_model,
};
pub(crate) use extension::register_extension;
pub(crate) use system::{health, system_hardware, system_performance, system_snapshot};
pub(crate) use windows::{
    hidden_window_monitor, hidden_window_monitor_post, hide_chrome_window, list_chrome_windows,
    show_chrome_window,
};
