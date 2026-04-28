use super::*;
use crate::model::runtime::portable_models_dir;

pub(super) async fn collect_portable_ollama_model_names(
    runtime_installed: bool,
    api_available: bool,
) -> Vec<String> {
    let mut installed_model_names = list_portable_ollama_models_from_disk()
        .unwrap_or_default()
        .into_iter()
        .collect::<BTreeSet<_>>();

    if runtime_installed && api_available {
        installed_model_names.extend(try_list_ollama_models().await.unwrap_or_default());
    }

    installed_model_names.into_iter().collect()
}

pub(super) fn build_model_statuses(installed_model_names: &[String]) -> Vec<ManagedAiModelStatus> {
    MANAGED_MODEL_SPECS
        .iter()
        .map(|spec| ManagedAiModelStatus {
            id: spec.id.to_string(),
            label: spec.label.to_string(),
            backend_model_name: spec.backend_model_name.to_string(),
            runtime_id: OLLAMA_RUNTIME_ID.to_string(),
            downloaded: installed_model_names
                .iter()
                .any(|name| model_name_matches(name, spec.backend_model_name)),
        })
        .collect()
}

fn list_portable_ollama_models_from_disk() -> Result<Vec<String>> {
    let manifests_root = portable_models_dir()?.join("manifests");

    if !manifests_root.exists() {
        return Ok(Vec::new());
    }

    let mut model_names = BTreeSet::new();

    for entry in WalkDir::new(&manifests_root)
        .into_iter()
        .filter_map(std::result::Result::ok)
    {
        if !entry.file_type().is_file() {
            continue;
        }

        let Ok(relative_path) = entry.path().strip_prefix(&manifests_root) else {
            continue;
        };

        let segments = relative_path
            .iter()
            .map(|segment| segment.to_string_lossy().to_string())
            .collect::<Vec<_>>();

        if segments.len() < 2 {
            continue;
        }

        let name = &segments[segments.len() - 2];
        let tag = &segments[segments.len() - 1];

        if name.is_empty() || tag.is_empty() {
            continue;
        }

        model_names.insert(format!("{name}:{tag}"));
    }

    Ok(model_names.into_iter().collect())
}

pub(crate) async fn try_get_ollama_version() -> Option<String> {
    let client = Client::builder().build().ok()?;
    let response = client
        .get(format!("{OLLAMA_API_BASE_URL}/version"))
        .timeout(Duration::from_secs(2))
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        return None;
    }

    let payload = response.json::<OllamaVersionResponse>().await.ok()?;
    Some(payload.version)
}

pub(crate) async fn try_get_portable_ollama_version() -> Option<String> {
    if !crate::model::runtime::has_running_portable_ollama_process() {
        return None;
    }

    try_get_ollama_version().await
}

pub(crate) async fn try_list_ollama_models() -> Result<Vec<String>> {
    let client = Client::builder().build()?;
    let response = client
        .get(format!("{OLLAMA_API_BASE_URL}/tags"))
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .context("failed to query portable Ollama model tags")?;

    if !response.status().is_success() {
        bail!(
            "portable Ollama tags query failed with status {}",
            response.status()
        );
    }

    let payload = response
        .json::<OllamaTagsResponse>()
        .await
        .context("failed to decode portable Ollama tags response")?;

    Ok(payload
        .models
        .into_iter()
        .flat_map(|model| [Some(model.name), model.model])
        .flatten()
        .collect())
}
