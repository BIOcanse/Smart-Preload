use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use serde_json::json;

use super::download::{build_download_client, download_archive, download_manifest};
use super::marker::{acquire_update_marker, update_marker_path, AcquireMarkerError};
use super::model::ValidatedUpdate;
use super::paths::{current_install_dir, update_token, updater_root};
use super::script::{build_handoff_script, HandoffScriptParameters};
use super::verification::verify_and_extract;

#[derive(Debug)]
pub(crate) enum UpdateStartError {
    AlreadyInProgress,
    Other(anyhow::Error),
}

impl fmt::Display for UpdateStartError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AlreadyInProgress => {
                formatter.write_str("another app update is already in progress")
            }
            Self::Other(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for UpdateStartError {}

pub(crate) struct UpdateJob {
    update: ValidatedUpdate,
    install_dir: PathBuf,
    stage_root: PathBuf,
    incoming_dir: PathBuf,
    backup_dir: PathBuf,
    marker_path: PathBuf,
    handoff_started: bool,
}

impl UpdateJob {
    pub(crate) fn start(update: ValidatedUpdate) -> Result<Self, UpdateStartError> {
        let install_dir = current_install_dir().map_err(UpdateStartError::Other)?;
        let updater_root = updater_root(&install_dir).map_err(UpdateStartError::Other)?;
        fs::create_dir_all(&updater_root)
            .context("failed to create updater data directory")
            .map_err(UpdateStartError::Other)?;
        let token = update_token(&update.target_version);
        let stage_root = updater_root.join("staging").join(&token);
        let install_parent = install_dir.parent().map(PathBuf::from).ok_or_else(|| {
            UpdateStartError::Other(anyhow::anyhow!(
                "local app installation directory has no parent"
            ))
        })?;
        let install_name = install_dir
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                UpdateStartError::Other(anyhow::anyhow!(
                    "local app installation directory has no valid name"
                ))
            })?;
        let incoming_dir = install_parent.join(format!(".{install_name}.incoming-{token}"));
        let backup_dir = install_parent.join(format!(".{install_name}.backup-{token}"));
        let marker_path = update_marker_path(&updater_root);
        acquire_update_marker(&marker_path, &update).map_err(|error| match error {
            AcquireMarkerError::AlreadyExists => UpdateStartError::AlreadyInProgress,
            AcquireMarkerError::Other(error) => UpdateStartError::Other(error),
        })?;

        let job = Self {
            update,
            install_dir,
            stage_root,
            incoming_dir,
            backup_dir,
            marker_path,
            handoff_started: false,
        };

        if let Err(error) = job.initialize_paths_and_marker() {
            drop(job);
            return Err(UpdateStartError::Other(error));
        }

        Ok(job)
    }

    pub(crate) async fn prepare_and_launch(mut self) -> Result<()> {
        self.write_marker("downloading-manifest")?;
        let client = build_download_client()?;
        let manifest_path = self.stage_root.join(&self.update.manifest_name);
        download_manifest(&client, &self.update.manifest_url, &manifest_path)
            .await
            .context("failed to download app update hash manifest")?;
        self.write_marker("downloading-signature")?;
        let signature_path = self.stage_root.join(&self.update.signature_name);
        download_manifest(&client, &self.update.signature_url, &signature_path)
            .await
            .context("failed to download app update manifest signature")?;

        self.write_marker("downloading-app")?;
        let archive_path = self.stage_root.join(&self.update.asset_name);
        download_archive(&client, &self.update.asset_url, &archive_path)
            .await
            .context("failed to download app update archive")?;

        self.write_marker("verifying")?;
        let asset_name = self.update.asset_name.clone();
        let target_version = self.update.target_version.clone();
        let incoming_dir = self.incoming_dir.clone();
        let archive_for_verification = archive_path.clone();
        let manifest_for_verification = manifest_path.clone();
        let signature_for_verification = signature_path.clone();
        tokio::task::spawn_blocking(move || {
            verify_and_extract(
                &archive_for_verification,
                &manifest_for_verification,
                &signature_for_verification,
                &asset_name,
                &incoming_dir,
                &target_version,
            )
        })
        .await
        .context("app update verification task failed")??;
        fs::remove_file(&signature_path)
            .context("failed to remove verified update signature from staging")?;

        let script_path = self.stage_root.join("run-native-app-update.ps1");
        let readiness_path = self.stage_root.join("handoff-ready.txt");
        let script = build_handoff_script(&HandoffScriptParameters {
            host_pid: std::process::id(),
            install_dir: &self.install_dir,
            incoming_dir: &self.incoming_dir,
            backup_dir: &self.backup_dir,
            stage_root: &self.stage_root,
            marker_path: &self.marker_path,
            readiness_path: &readiness_path,
            archive_path: &archive_path,
            manifest_path: &manifest_path,
            target_version: &self.update.target_version,
        });
        fs::write(&script_path, script).context("failed to write app update handoff script")?;

        self.write_marker("handoff-ready")?;
        let mut handoff_process = spawn_handoff_script(&script_path, &self.stage_root)
            .context("failed to launch app update handoff process")?;
        wait_for_handoff_readiness(&mut handoff_process, &readiness_path).await?;
        self.handoff_started = true;
        Ok(())
    }

    fn initialize_paths_and_marker(&self) -> Result<()> {
        if self.stage_root.exists() || self.incoming_dir.exists() || self.backup_dir.exists() {
            bail!("update transaction paths already exist");
        }

        fs::create_dir_all(&self.stage_root)
            .context("failed to create update staging directory")?;
        self.write_marker("preparing")
    }

    fn write_marker(&self, phase: &str) -> Result<()> {
        let marker = json!({
            "schemaVersion": 1,
            "phase": phase,
            "targetVersion": self.update.target_version,
            "releaseTag": self.update.release_tag,
            "ownerPid": std::process::id(),
            "installDir": self.install_dir,
            "incomingDir": self.incoming_dir,
            "backupDir": self.backup_dir,
            "stageRoot": self.stage_root,
            "updatedAtUtc": chrono::Utc::now().to_rfc3339(),
        });
        fs::write(&self.marker_path, serde_json::to_vec(&marker)?)
            .context("failed to update app update marker")?;
        Ok(())
    }
}

impl Drop for UpdateJob {
    fn drop(&mut self) {
        if self.handoff_started {
            return;
        }

        remove_directory_if_exists(&self.incoming_dir);
        remove_directory_if_exists(&self.stage_root);
        let _ = fs::remove_file(&self.marker_path);
    }
}

fn spawn_handoff_script(script_path: &Path, stage_root: &Path) -> Result<std::process::Child> {
    let mut command = Command::new("powershell.exe");
    command
        .arg("-NoLogo")
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(script_path)
        .current_dir(stage_root);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }

    command
        .spawn()
        .context("failed to start PowerShell handoff")
}

async fn wait_for_handoff_readiness(
    process: &mut std::process::Child,
    readiness_path: &Path,
) -> Result<()> {
    const MAX_ATTEMPTS: usize = 100;
    const POLL_INTERVAL: Duration = Duration::from_millis(50);

    for _ in 0..MAX_ATTEMPTS {
        if readiness_path.is_file() {
            return Ok(());
        }
        if let Some(status) = process.try_wait()? {
            bail!("app update handoff exited before becoming ready: {status}");
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }

    let _ = process.kill();
    bail!("app update handoff did not become ready within five seconds")
}

fn remove_directory_if_exists(path: &Path) {
    if path.exists() {
        let _ = fs::remove_dir_all(path);
    }
}
