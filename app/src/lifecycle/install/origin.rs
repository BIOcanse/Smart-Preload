use super::super::{ensure_portable_parent_dir, portable_path};
use anyhow::Result;
use std::collections::BTreeSet;
use std::fs;

pub(super) fn persist_allowed_extension_origins(extension_ids: &[String]) -> Result<()> {
    let origin_path = portable_path("allowed-extension-origin.txt")?;
    let origins_path = portable_path("allowed-extension-origins.txt")?;
    let origins = extension_ids
        .iter()
        .map(|extension_id| format!("chrome-extension://{extension_id}"))
        .collect::<BTreeSet<_>>();
    ensure_portable_parent_dir(&origin_path)?;
    ensure_portable_parent_dir(&origins_path)?;

    if let Some(first_origin) = origins.iter().next() {
        fs::write(origin_path, first_origin)?;
    }

    fs::write(
        origins_path,
        origins.into_iter().collect::<Vec<_>>().join("\n"),
    )?;
    Ok(())
}
