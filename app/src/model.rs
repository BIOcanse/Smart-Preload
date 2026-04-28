use std::collections::BTreeSet;
use std::env;
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sysinfo::{ProcessesToUpdate, Signal, System};
use walkdir::WalkDir;
use zip::ZipArchive;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

mod catalog;
mod infer;
mod runtime;
mod status;
mod types;
pub(crate) const CREATE_NO_WINDOW: u32 = 0x0800_0000;

use catalog::*;
pub use types::*;

pub async fn get_ai_model_manager_status() -> Result<AiModelManagerStatus> {
    status::build_model_manager_status().await
}

pub async fn install_managed_model(request: &ManageModelRequest) -> Result<AiModelManagerStatus> {
    infer::install_managed_model(request).await
}

pub async fn uninstall_managed_model(request: &ManageModelRequest) -> Result<AiModelManagerStatus> {
    infer::uninstall_managed_model(request).await
}

pub async fn invoke_managed_model(
    request: &InvokeManagedModelRequest,
) -> Result<InvokeManagedModelResponse> {
    infer::invoke_managed_model(request).await
}

pub fn snapshot_ai_progress() -> Option<AiProgress> {
    infer::snapshot_ai_progress()
}

pub fn shutdown_managed_runtimes() -> Result<()> {
    runtime::stop_tracked_ollama_child()?;
    runtime::kill_portable_ollama_processes();
    Ok(())
}
