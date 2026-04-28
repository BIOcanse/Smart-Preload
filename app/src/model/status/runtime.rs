use super::*;
use crate::model::runtime::{
    portable_models_dir, portable_runtime_dir, read_portable_ollama_cli_version,
};

pub(super) fn build_runtime_status(
    executable_path: Option<PathBuf>,
    api_version: Option<String>,
) -> Result<ManagedAiRuntimeStatus> {
    let runtime_dir = portable_runtime_dir()?;
    let models_dir = portable_models_dir()?;
    let runtime_installed = executable_path.is_some();
    let api_available = api_version.is_some();

    Ok(ManagedAiRuntimeStatus {
        id: OLLAMA_RUNTIME_ID.to_string(),
        label: OLLAMA_RUNTIME_LABEL.to_string(),
        installed: runtime_installed,
        api_available,
        version: api_version.or_else(|| {
            executable_path
                .as_deref()
                .and_then(read_portable_ollama_cli_version)
        }),
        executable_path: executable_path.map(|path| path.to_string_lossy().to_string()),
        runtime_directory: runtime_dir.to_string_lossy().to_string(),
        models_directory: models_dir.to_string_lossy().to_string(),
    })
}
