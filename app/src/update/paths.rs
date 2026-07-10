use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Result;

pub(super) fn current_install_dir() -> Result<PathBuf> {
    let executable_path = std::env::current_exe()?;
    executable_path
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| anyhow::anyhow!("local app executable directory is not available"))
}

pub(super) fn updater_root(install_dir: &Path) -> Result<PathBuf> {
    let base_dir = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    updater_root_for_base(&base_dir, install_dir)
}

pub(super) fn update_token(target_version: &str) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("v{target_version}-{}-{timestamp}", std::process::id())
}

fn updater_root_for_base(base_dir: &Path, install_dir: &Path) -> Result<PathBuf> {
    let default_root = base_dir.join("ZeroLatencyWeb").join("updates");
    if !path_is_within(&default_root, install_dir) {
        return Ok(default_root);
    }

    let install_parent = install_dir
        .parent()
        .ok_or_else(|| anyhow::anyhow!("local app installation directory has no parent"))?;
    Ok(install_parent.join(".SmartPreload-updater"))
}

fn path_is_within(candidate: &Path, parent: &Path) -> bool {
    let candidate = candidate
        .to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase();
    let parent = parent
        .to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase();

    candidate == parent || candidate.starts_with(&(parent + "\\"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn updater_data_never_lives_inside_the_installation_directory() {
        let install_dir = Path::new(r"C:\Users\test\AppData\Local\ZeroLatencyWeb");
        let updater_dir =
            updater_root_for_base(Path::new(r"C:\Users\test\AppData\Local"), install_dir)
                .expect("updater root");

        assert!(!path_is_within(&updater_dir, install_dir));
        assert_eq!(
            updater_dir,
            PathBuf::from(r"C:\Users\test\AppData\Local\.SmartPreload-updater")
        );
    }
}
