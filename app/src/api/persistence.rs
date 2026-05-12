use std::collections::BTreeSet;
use std::env;
use std::fs;
use std::path::PathBuf;

use anyhow::Result;

use super::origin::normalize_extension_origin;

pub(super) fn load_allowed_extension_origins() -> BTreeSet<String> {
    let mut origins = BTreeSet::new();

    for path in [
        allowed_extension_origins_path().ok(),
        allowed_extension_origin_path().ok(),
    ]
    .into_iter()
    .flatten()
    {
        let Ok(raw_value) = fs::read_to_string(path) else {
            continue;
        };

        for line in raw_value.lines() {
            if let Some(origin) = normalize_extension_origin(line) {
                origins.insert(origin);
            }
        }
    }

    origins
}

pub(super) fn persist_allowed_extension_origins(origins: &BTreeSet<String>) -> Result<()> {
    let origins_path = allowed_extension_origins_path()?;

    if let Some(parent) = origins_path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(
        origins_path,
        origins.iter().cloned().collect::<Vec<_>>().join("\n"),
    )?;

    if let Some(first_origin) = origins.iter().next() {
        let legacy_origin_path = allowed_extension_origin_path()?;

        if let Some(parent) = legacy_origin_path.parent() {
            fs::create_dir_all(parent)?;
        }

        fs::write(legacy_origin_path, first_origin)?;
    }

    Ok(())
}

pub(super) fn load_debug_api_token() -> Option<String> {
    let token_path = debug_api_token_path().ok()?;
    let token = fs::read_to_string(token_path).ok()?;
    let trimmed = token.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn allowed_extension_origin_path() -> Result<PathBuf> {
    let executable_path = env::current_exe()?;
    let executable_dir = executable_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("local app executable directory is not available"))?;
    Ok(executable_dir
        .join("portable")
        .join("allowed-extension-origin.txt"))
}

fn allowed_extension_origins_path() -> Result<PathBuf> {
    let executable_path = env::current_exe()?;
    let executable_dir = executable_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("local app executable directory is not available"))?;
    Ok(executable_dir
        .join("portable")
        .join("allowed-extension-origins.txt"))
}

fn debug_api_token_path() -> Result<PathBuf> {
    let executable_path = env::current_exe()?;
    let executable_dir = executable_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("local app executable directory is not available"))?;
    Ok(executable_dir.join("portable").join("debug-api-token.txt"))
}
