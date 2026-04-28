use super::*;

static AI_PROGRESS: OnceLock<Mutex<Option<AiProgress>>> = OnceLock::new();

fn progress_slot() -> &'static Mutex<Option<AiProgress>> {
    AI_PROGRESS.get_or_init(|| Mutex::new(None))
}

pub(crate) fn snapshot_ai_progress() -> Option<AiProgress> {
    progress_slot().lock().ok()?.clone()
}

fn now_unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn begin_progress(model_id: &str, action: &str, stage: &str, message: &str) {
    let Ok(mut guard) = progress_slot().lock() else {
        return;
    };
    let now = now_unix_ms();
    *guard = Some(AiProgress {
        model_id: model_id.to_string(),
        action: action.to_string(),
        stage: stage.to_string(),
        message: message.to_string(),
        completed_bytes: 0,
        total_bytes: 0,
        started_at_ms: now,
        updated_at_ms: now,
        finished: false,
        error: None,
    });
}

fn update_progress(updater: impl FnOnce(&mut AiProgress)) {
    let Ok(mut guard) = progress_slot().lock() else {
        return;
    };
    if let Some(progress) = guard.as_mut() {
        updater(progress);
        progress.updated_at_ms = now_unix_ms();
    }
}

fn finish_progress(stage: &str, message: &str) {
    update_progress(|progress| {
        progress.stage = stage.to_string();
        progress.message = message.to_string();
        progress.finished = true;
    });
}

fn fail_progress(error_text: &str) {
    update_progress(|progress| {
        progress.stage = "failed".to_string();
        progress.message = format!("Failed: {error_text}");
        progress.error = Some(error_text.to_string());
        progress.finished = true;
    });
}

pub(super) async fn install_managed_model(
    request: &ManageModelRequest,
) -> Result<AiModelManagerStatus> {
    let spec = super::get_model_spec(&request.model_id)?;

    begin_progress(
        spec.id,
        "install",
        "ensuring-runtime",
        "Preparing portable runtime if needed.",
    );

    let outcome: Result<()> = async {
        runtime::ensure_portable_ollama_runtime_ready()
            .await
            .context("failed to prepare the portable runtime")?;

        update_progress(|progress| {
            progress.stage = "downloading".to_string();
            progress.message = "Starting model download.".to_string();
        });

        ollama_pull_model_streaming(spec.backend_model_name).await
    }
    .await;

    match outcome.as_ref() {
        Ok(()) => finish_progress("complete", "Model downloaded."),
        Err(error) => fail_progress(&format!("{error:#}")),
    }

    let status = status::build_model_manager_status().await;
    outcome?;
    status
}

pub(super) async fn uninstall_managed_model(
    request: &ManageModelRequest,
) -> Result<AiModelManagerStatus> {
    let spec = super::get_model_spec(&request.model_id)?;

    begin_progress(spec.id, "uninstall", "removing", "Removing model.");

    let outcome: Result<()> = async {
        if !runtime::portable_ollama_runtime_installed() {
            return Ok(());
        }

        let api_reachable = status::try_get_ollama_version().await.is_some();
        let mut clean_path_succeeded = false;

        if api_reachable {
            match ollama_delete_model(spec.backend_model_name).await {
                Ok(()) => clean_path_succeeded = true,
                Err(error) => {
                    tracing::warn!(
                        "ollama API delete failed for {}: {error:#}; falling back to disk removal",
                        spec.label
                    );
                }
            }
        } else {
            update_progress(|progress| {
                progress.message =
                    "Ollama API unreachable, force-removing model files.".to_string();
            });
            tracing::warn!(
                "ollama API unreachable for {} uninstall; falling back to disk removal",
                spec.label
            );
        }

        if !clean_path_succeeded {
            runtime::stop_tracked_ollama_child().ok();
            runtime::kill_portable_ollama_processes();
            force_remove_model_manifest(spec.backend_model_name)?;
        }

        update_progress(|progress| {
            progress.stage = "pruning".to_string();
            progress.message = "Pruning runtime if no models remain.".to_string();
        });

        prune_portable_ollama_runtime_if_unused().await
    }
    .await;

    match outcome.as_ref() {
        Ok(()) => finish_progress("complete", "Model removed."),
        Err(error) => fail_progress(&format!("{error:#}")),
    }

    let status = status::build_model_manager_status().await;
    outcome?;
    status
}

pub(super) async fn invoke_managed_model(
    request: &InvokeManagedModelRequest,
) -> Result<InvokeManagedModelResponse> {
    let spec = super::get_model_spec(&request.model_id)?;
    ensure_managed_model_available(spec).await?;

    let output_text = ollama_generate(
        spec.backend_model_name,
        &request.prompt,
        request.response_format.as_deref(),
    )
    .await?;

    Ok(InvokeManagedModelResponse {
        model_id: spec.id.to_string(),
        runtime_id: OLLAMA_RUNTIME_ID.to_string(),
        backend_model_name: spec.backend_model_name.to_string(),
        output_text,
    })
}

async fn ensure_managed_model_available(spec: &ManagedModelSpec) -> Result<()> {
    runtime::ensure_portable_ollama_runtime_ready().await?;
    let installed_models = status::try_list_ollama_models().await.unwrap_or_default();

    if installed_models
        .iter()
        .any(|name| model_name_matches(name, spec.backend_model_name))
    {
        return Ok(());
    }

    bail!(
        "managed model {} is not downloaded in the portable runtime",
        spec.label
    )
}

async fn prune_portable_ollama_runtime_if_unused() -> Result<()> {
    let status = status::build_model_manager_status().await?;
    let has_any_managed_model = status.models.iter().any(|model| model.downloaded);

    if has_any_managed_model {
        return Ok(());
    }

    runtime::stop_tracked_ollama_child()?;
    runtime::kill_portable_ollama_processes();

    let runtime_dir = runtime::portable_runtime_dir()?;
    let models_dir = runtime::portable_models_dir()?;

    if runtime_dir.exists() {
        fs::remove_dir_all(&runtime_dir).with_context(|| {
            format!(
                "failed to remove portable Ollama runtime directory: {}",
                runtime_dir.display()
            )
        })?;
    }

    if models_dir.exists() {
        fs::remove_dir_all(&models_dir).with_context(|| {
            format!(
                "failed to remove portable Ollama models directory: {}",
                models_dir.display()
            )
        })?;
    }

    Ok(())
}

fn force_remove_model_manifest(backend_model_name: &str) -> Result<()> {
    let manifests_root = runtime::portable_models_dir()?.join("manifests");

    if !manifests_root.exists() {
        return Ok(());
    }

    let Some((target_name, target_tag)) = backend_model_name.split_once(':') else {
        bail!("cannot force-remove unknown ollama model name: {backend_model_name}");
    };

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

        let manifest_name = &segments[segments.len() - 2];
        let manifest_tag = &segments[segments.len() - 1];

        if manifest_name.eq_ignore_ascii_case(target_name)
            && manifest_tag.eq_ignore_ascii_case(target_tag)
        {
            fs::remove_file(entry.path()).with_context(|| {
                format!(
                    "failed to force-remove model manifest at {}",
                    entry.path().display()
                )
            })?;
        }
    }

    Ok(())
}

async fn ollama_pull_model_streaming(model_name: &str) -> Result<()> {
    let client = Client::builder().build()?;
    let mut response = client
        .post(format!("{OLLAMA_API_BASE_URL}/pull"))
        .json(&serde_json::json!({
            "model": model_name,
            "stream": true,
        }))
        .timeout(Duration::from_secs(60 * 60))
        .send()
        .await
        .with_context(|| format!("failed to pull model {model_name} via portable Ollama"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        bail!("portable Ollama pull failed with status {status}: {body}");
    }

    let mut buffer = Vec::<u8>::new();
    let mut last_status_text = String::new();

    while let Some(chunk) = response
        .chunk()
        .await
        .context("failed to read portable Ollama pull stream chunk")?
    {
        buffer.extend_from_slice(&chunk);

        while let Some(newline_index) = buffer.iter().position(|byte| *byte == b'\n') {
            let line_bytes: Vec<u8> = buffer.drain(..=newline_index).collect();
            let line = std::str::from_utf8(&line_bytes).unwrap_or("").trim();

            if line.is_empty() {
                continue;
            }

            let event = match serde_json::from_str::<OllamaPullEvent>(line) {
                Ok(parsed) => parsed,
                Err(_) => continue,
            };

            if let Some(error_text) = event.error {
                bail!("portable Ollama pull stream reported error: {error_text}");
            }

            let total_bytes = event.total.unwrap_or(0);
            let completed_bytes = event.completed.unwrap_or(0);

            if let Some(status_text) = event.status {
                if !status_text.is_empty() {
                    last_status_text = status_text;
                }
            }

            update_progress(|progress| {
                progress.completed_bytes = completed_bytes;
                progress.total_bytes = total_bytes;
                progress.message =
                    format_pull_message(&last_status_text, completed_bytes, total_bytes);
            });
        }
    }

    Ok(())
}

fn format_pull_message(status_text: &str, completed_bytes: u64, total_bytes: u64) -> String {
    let trimmed_status = status_text.trim();

    if total_bytes > 0 {
        let percent = ((completed_bytes as f64 / total_bytes as f64) * 100.0).round() as u64;
        let label = if trimmed_status.is_empty() {
            "downloading"
        } else {
            trimmed_status
        };
        format!(
            "{label}: {} / {} ({percent}%)",
            humanize_bytes(completed_bytes),
            humanize_bytes(total_bytes)
        )
    } else if trimmed_status.is_empty() {
        "Working...".to_string()
    } else {
        trimmed_status.to_string()
    }
}

fn humanize_bytes(bytes: u64) -> String {
    const UNITS: &[&str] = &["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit_index = 0;

    while value >= 1024.0 && unit_index < UNITS.len() - 1 {
        value /= 1024.0;
        unit_index += 1;
    }

    if unit_index == 0 {
        format!("{bytes} {}", UNITS[unit_index])
    } else {
        format!("{value:.2} {}", UNITS[unit_index])
    }
}

#[derive(Debug, Deserialize)]
struct OllamaPullEvent {
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    total: Option<u64>,
    #[serde(default)]
    completed: Option<u64>,
    #[serde(default)]
    error: Option<String>,
}

async fn ollama_delete_model(model_name: &str) -> Result<()> {
    let client = Client::builder().build()?;
    let response = client
        .delete(format!("{OLLAMA_API_BASE_URL}/delete"))
        .json(&serde_json::json!({
            "model": model_name,
        }))
        .timeout(Duration::from_secs(120))
        .send()
        .await
        .with_context(|| format!("failed to delete model {model_name} via portable Ollama"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        bail!("portable Ollama delete failed with status {status}: {body}");
    }

    Ok(())
}

async fn ollama_generate(
    model_name: &str,
    prompt: &str,
    response_format: Option<&str>,
) -> Result<String> {
    let mut body = serde_json::json!({
        "model": model_name,
        "prompt": prompt,
        "stream": false,
    });

    if matches!(response_format, Some(format) if format.eq_ignore_ascii_case("json")) {
        body["format"] = serde_json::Value::String("json".to_string());
    }

    let client = Client::builder().build()?;
    let response = client
        .post(format!("{OLLAMA_API_BASE_URL}/generate"))
        .json(&body)
        .timeout(Duration::from_secs(10 * 60))
        .send()
        .await
        .with_context(|| format!("failed to invoke model {model_name}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        bail!("portable Ollama generate failed with status {status}: {body}");
    }

    let payload = response
        .json::<OllamaGenerateResponse>()
        .await
        .context("failed to decode portable Ollama generate response")?;

    Ok(payload.response)
}
