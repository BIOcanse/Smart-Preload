use super::*;

pub(crate) async fn ensure_portable_ollama_api_available() -> Result<()> {
    if super::status::try_get_portable_ollama_version()
        .await
        .is_some()
    {
        return Ok(());
    }

    if super::status::try_get_ollama_version().await.is_some() {
        bail!(
            "Ollama API at {} is already occupied by a non-portable instance; refusing to reuse system/default runtime",
            OLLAMA_HOST
        );
    }

    start_portable_ollama_serve()?;

    let started_at = Instant::now();
    while started_at.elapsed() < OLLAMA_API_WAIT_TIMEOUT {
        if super::status::try_get_portable_ollama_version()
            .await
            .is_some()
        {
            return Ok(());
        }

        if super::status::try_get_ollama_version().await.is_some() {
            bail!(
                "Ollama API at {} became ready but is not owned by the portable runtime",
                OLLAMA_HOST
            );
        }

        tokio::time::sleep(OLLAMA_API_POLL_INTERVAL).await;
    }

    bail!("portable Ollama API did not become ready in time")
}

pub(crate) fn read_portable_ollama_cli_version(executable_path: &Path) -> Option<String> {
    let output = Command::new(executable_path)
        .arg("--version")
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        None
    } else {
        Some(stdout)
    }
}

fn start_portable_ollama_serve() -> Result<()> {
    if try_lock_tracked_child()?.is_some() {
        return Ok(());
    }

    let executable_path = find_portable_ollama_executable()
        .ok_or_else(|| anyhow!("portable Ollama executable not found"))?;
    let runtime_dir = portable_runtime_dir()?;
    let models_dir = portable_models_dir()?;

    fs::create_dir_all(&models_dir)?;

    let mut command = Command::new(executable_path);
    command
        .arg("serve")
        .current_dir(runtime_dir)
        .env("OLLAMA_HOST", OLLAMA_HOST)
        .env("OLLAMA_MODELS", &models_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let child = command
        .spawn()
        .context("failed to spawn portable Ollama serve process")?;
    *ollama_child_slot()
        .lock()
        .map_err(|_| anyhow!("portable Ollama child slot lock poisoned"))? = Some(child);
    Ok(())
}

fn try_lock_tracked_child() -> Result<Option<u32>> {
    let mut guard = ollama_child_slot()
        .lock()
        .map_err(|_| anyhow!("portable Ollama child slot lock poisoned"))?;

    if let Some(child) = guard.as_mut() {
        if let Some(_status) = child.try_wait().ok().flatten() {
            *guard = None;
            return Ok(None);
        }

        return Ok(Some(child.id()));
    }

    Ok(None)
}

pub(crate) fn has_running_portable_ollama_process() -> bool {
    if try_lock_tracked_child().ok().flatten().is_some() {
        return true;
    }

    let Some(executable_path) = find_portable_ollama_executable() else {
        return false;
    };

    let executable_path = executable_path.to_string_lossy().to_ascii_lowercase();
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);

    system.processes().values().any(|process| {
        process
            .exe()
            .map(|process_path| {
                process_path
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .eq(&executable_path)
            })
            .unwrap_or(false)
    })
}

pub(crate) fn stop_tracked_ollama_child() -> Result<()> {
    let mut guard = ollama_child_slot()
        .lock()
        .map_err(|_| anyhow!("portable Ollama child slot lock poisoned"))?;

    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }

    Ok(())
}

pub(crate) fn kill_portable_ollama_processes() {
    let Some(executable_path) = find_portable_ollama_executable() else {
        return;
    };

    let executable_path = executable_path.to_string_lossy().to_ascii_lowercase();
    let mut system = System::new_all();
    system.refresh_processes(ProcessesToUpdate::All, true);

    for process in system.processes().values() {
        let Some(process_path) = process.exe() else {
            continue;
        };

        if process_path
            .to_string_lossy()
            .to_ascii_lowercase()
            .eq(&executable_path)
        {
            let _ = process.kill_with(Signal::Kill);
        }
    }
}
