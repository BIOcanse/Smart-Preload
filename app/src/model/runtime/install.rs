use super::*;

pub(crate) async fn ensure_portable_ollama_runtime_ready() -> Result<()> {
    if !portable_ollama_runtime_installed() {
        install_portable_ollama_runtime().await?;
    }

    ensure_portable_ollama_api_available().await?;
    Ok(())
}

pub(crate) async fn install_portable_ollama_runtime() -> Result<()> {
    let runtime_dir = portable_runtime_dir()?;
    let archive_bytes = download_portable_ollama_archive().await?;

    if runtime_dir.exists() {
        fs::remove_dir_all(&runtime_dir).with_context(|| {
            format!(
                "failed to clear old portable Ollama runtime directory: {}",
                runtime_dir.display()
            )
        })?;
    }

    fs::create_dir_all(&runtime_dir).with_context(|| {
        format!(
            "failed to create portable Ollama runtime directory: {}",
            runtime_dir.display()
        )
    })?;

    extract_zip_archive(&archive_bytes, &runtime_dir)?;
    fs::create_dir_all(portable_models_dir()?)?;

    if find_portable_ollama_executable().is_none() {
        bail!("portable Ollama runtime installed but ollama.exe was not found")
    }

    Ok(())
}

async fn download_portable_ollama_archive() -> Result<Vec<u8>> {
    let client = Client::builder()
        .build()
        .context("failed to build HTTP client for portable Ollama download")?;
    let response = client
        .get(portable_ollama_download_url())
        .send()
        .await
        .context("failed to download portable Ollama runtime archive")?;

    if !response.status().is_success() {
        bail!(
            "portable Ollama runtime download failed with status {}",
            response.status()
        );
    }

    let bytes = response
        .bytes()
        .await
        .context("failed to read portable Ollama runtime archive bytes")?;
    Ok(bytes.to_vec())
}

fn extract_zip_archive(bytes: &[u8], target_dir: &Path) -> Result<()> {
    let reader = Cursor::new(bytes);
    let mut archive =
        ZipArchive::new(reader).context("failed to open portable Ollama runtime archive")?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .with_context(|| format!("failed to read zip entry {index}"))?;
        let Some(relative_path) = entry.enclosed_name().map(|path| path.to_owned()) else {
            continue;
        };
        let output_path = target_dir.join(relative_path);

        if entry.is_dir() {
            fs::create_dir_all(&output_path)?;
            continue;
        }

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut output_file = fs::File::create(&output_path).with_context(|| {
            format!("failed to create extracted file {}", output_path.display())
        })?;
        let mut buffer = Vec::new();
        entry.read_to_end(&mut buffer)?;
        output_file.write_all(&buffer)?;
    }

    Ok(())
}
