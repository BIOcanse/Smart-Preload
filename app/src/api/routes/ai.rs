use axum::http::StatusCode;
use axum::Json;

use crate::model::{
    self, AiModelManagerStatus, AiProgress, InvokeManagedModelRequest, InvokeManagedModelResponse,
    ManageModelRequest,
};

pub(crate) async fn ai_status() -> Result<Json<AiModelManagerStatus>, (StatusCode, String)> {
    model::get_ai_model_manager_status()
        .await
        .map(Json)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

pub(crate) async fn install_ai_model(
    Json(request): Json<ManageModelRequest>,
) -> Result<Json<AiModelManagerStatus>, (StatusCode, String)> {
    model::install_managed_model(&request)
        .await
        .map(Json)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

pub(crate) async fn uninstall_ai_model(
    Json(request): Json<ManageModelRequest>,
) -> Result<Json<AiModelManagerStatus>, (StatusCode, String)> {
    model::uninstall_managed_model(&request)
        .await
        .map(Json)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

pub(crate) async fn invoke_ai_model(
    Json(request): Json<InvokeManagedModelRequest>,
) -> Result<Json<InvokeManagedModelResponse>, (StatusCode, String)> {
    model::invoke_managed_model(&request)
        .await
        .map(Json)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

pub(crate) async fn ai_progress() -> Json<Option<AiProgress>> {
    Json(model::snapshot_ai_progress())
}
