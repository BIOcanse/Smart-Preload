use super::super::{ensure_portable_parent_dir, portable_path};
use anyhow::Result;
use std::fs;

pub(super) fn persist_allowed_extension_origin(extension_id: &str) -> Result<()> {
    let origin_path = portable_path("allowed-extension-origin.txt")?;
    let origins_path = portable_path("allowed-extension-origins.txt")?;
    let origin = format!("chrome-extension://{extension_id}");
    ensure_portable_parent_dir(&origin_path)?;
    ensure_portable_parent_dir(&origins_path)?;
    fs::write(origin_path, &origin)?;
    fs::write(origins_path, origin)?;
    Ok(())
}
