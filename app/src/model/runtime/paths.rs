use super::*;

pub(crate) fn portable_ollama_runtime_installed() -> bool {
    find_portable_ollama_executable().is_some()
}

pub(crate) fn find_portable_ollama_executable() -> Option<PathBuf> {
    let runtime_dir = portable_runtime_dir().ok()?;

    if !runtime_dir.exists() {
        return None;
    }

    for entry in WalkDir::new(runtime_dir)
        .into_iter()
        .filter_map(std::result::Result::ok)
    {
        if !entry.file_type().is_file() {
            continue;
        }

        if entry
            .file_name()
            .to_string_lossy()
            .eq_ignore_ascii_case("ollama.exe")
        {
            return Some(entry.into_path());
        }
    }

    None
}

pub(crate) fn portable_root_dir() -> Result<PathBuf> {
    let executable = env::current_exe().context("failed to resolve local app path")?;
    let executable_dir = executable
        .parent()
        .ok_or_else(|| anyhow!("local app executable directory is not available"))?;
    Ok(executable_dir.join(OLLAMA_PORTABLE_ROOT_DIR))
}

pub(crate) fn portable_runtime_dir() -> Result<PathBuf> {
    Ok(portable_root_dir()?.join(OLLAMA_RUNTIME_DIR))
}

pub(crate) fn portable_models_dir() -> Result<PathBuf> {
    Ok(portable_root_dir()?.join(OLLAMA_MODELS_DIR))
}

pub(crate) fn portable_ollama_download_url() -> &'static str {
    match env::consts::ARCH {
        "aarch64" => OLLAMA_WINDOWS_ARM64_ZIP,
        _ => OLLAMA_WINDOWS_AMD64_ZIP,
    }
}
