use axum::extract::State;
use axum::Json;

use crate::api::ApiState;
use crate::window::{
    self, ChromeWindowInfo, HiddenWindowMonitorSnapshot, HideWindowRequest, HideWindowResponse,
    ShowWindowRequest, ShowWindowResponse,
};

pub(crate) async fn list_chrome_windows(
    State(state): State<ApiState>,
) -> Json<Vec<ChromeWindowInfo>> {
    Json(window::list_chrome_windows(&state.process_sampler()))
}

pub(crate) async fn hidden_window_monitor() -> Json<HiddenWindowMonitorSnapshot> {
    Json(window::hidden_window_monitor_snapshot())
}

pub(crate) async fn hidden_window_monitor_post() -> Json<HiddenWindowMonitorSnapshot> {
    Json(window::hidden_window_monitor_snapshot())
}

pub(crate) async fn hide_chrome_window(
    State(state): State<ApiState>,
    Json(request): Json<HideWindowRequest>,
) -> Json<HideWindowResponse> {
    Json(window::request_hide_chrome_window(
        &state.process_sampler(),
        &request,
    ))
}

pub(crate) async fn show_chrome_window(
    Json(request): Json<ShowWindowRequest>,
) -> Json<ShowWindowResponse> {
    Json(window::request_show_chrome_window(&request))
}
