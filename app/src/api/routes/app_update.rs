use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::api::ApiState;
use crate::runtime_debug::record_app_runtime_event;

use crate::update::model::{validate_update_request, UpdateRequest};
use crate::update::{self as updater, UpdateJob, UpdateStartError};

pub(crate) async fn app_update_status() -> Json<AppUpdateStatusResponse> {
    Json(AppUpdateStatusResponse {
        ok: true,
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        update_supported: cfg!(target_os = "windows"),
        updater_status: if cfg!(target_os = "windows") {
            updater::updater_status()
        } else {
            "unsupported-platform".to_string()
        },
    })
}

pub(crate) async fn request_app_update(
    State(state): State<ApiState>,
    Json(payload): Json<AppUpdateRequest>,
) -> Result<Json<AppUpdateRequestResponse>, (StatusCode, String)> {
    if !cfg!(target_os = "windows") {
        return Err((
            StatusCode::NOT_IMPLEMENTED,
            "native app updater is only supported on Windows".to_string(),
        ));
    }

    let update = validate_update_request(payload.into(), env!("CARGO_PKG_VERSION"))
        .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;
    let target_version = update.target_version.clone();
    let job = UpdateJob::start(update).map_err(|error| match error {
        UpdateStartError::AlreadyInProgress => (StatusCode::CONFLICT, error.to_string()),
        UpdateStartError::Other(_) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
    })?;

    let background_state = state.clone();
    let background_target_version = target_version.clone();
    tokio::spawn(async move {
        record_app_runtime_event(
            "updater",
            "app-update-preparing",
            Some(format!("targetVersion={background_target_version}")),
        );

        match job.prepare_and_launch().await {
            Ok(()) => {
                record_app_runtime_event(
                    "updater",
                    "app-update-handoff-started",
                    Some(format!("targetVersion={background_target_version}")),
                );
                background_state.request_host_shutdown();
            }
            Err(error) => {
                record_app_runtime_event(
                    "updater",
                    "app-update-preparation-failed",
                    Some(format!(
                        "targetVersion={background_target_version}::error={error}"
                    )),
                );
                tracing::error!(
                    "app update preparation for v{} failed: {}",
                    background_target_version,
                    error
                );
            }
        }
    });

    Ok(Json(AppUpdateRequestResponse {
        ok: true,
        accepted: true,
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        target_version,
        updater_status: "preparing".to_string(),
        message: "native app update download and verification started".to_string(),
    }))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateStatusResponse {
    ok: bool,
    current_version: String,
    update_supported: bool,
    updater_status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateRequest {
    target_version: String,
    asset_name: String,
    asset_url: String,
    release_url: String,
}

impl From<AppUpdateRequest> for UpdateRequest {
    fn from(value: AppUpdateRequest) -> Self {
        Self {
            target_version: value.target_version,
            asset_name: value.asset_name,
            asset_url: value.asset_url,
            release_url: value.release_url,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateRequestResponse {
    ok: bool,
    accepted: bool,
    current_version: String,
    target_version: String,
    updater_status: String,
    message: String,
}
