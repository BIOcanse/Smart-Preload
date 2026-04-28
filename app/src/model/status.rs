use super::*;

mod models;
mod runtime;

pub(super) async fn build_model_manager_status() -> Result<AiModelManagerStatus> {
    let portable_root = crate::model::runtime::portable_root_dir()?;
    let executable_path = crate::model::runtime::find_portable_ollama_executable();
    let runtime_installed = executable_path.is_some();
    let api_version = if runtime_installed {
        models::try_get_portable_ollama_version().await
    } else {
        None
    };
    let api_available = api_version.is_some();
    let installed_model_names =
        models::collect_portable_ollama_model_names(runtime_installed, api_available).await;

    Ok(AiModelManagerStatus {
        supported: cfg!(windows),
        provider: "ollama".to_string(),
        portable_root: portable_root.to_string_lossy().to_string(),
        runtimes: vec![runtime::build_runtime_status(executable_path, api_version)?],
        models: models::build_model_statuses(&installed_model_names),
    })
}

pub(crate) use models::{
    try_get_ollama_version, try_get_portable_ollama_version, try_list_ollama_models,
};
