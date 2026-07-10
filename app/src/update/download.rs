use std::path::Path;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use reqwest::redirect::Policy;
use tokio::io::AsyncWriteExt;

const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_APP_ARCHIVE_BYTES: u64 = 128 * 1024 * 1024;

pub(super) fn build_download_client() -> Result<reqwest::Client> {
    let redirect_policy = Policy::custom(|attempt| {
        if attempt.previous().len() >= 8 {
            return attempt.error("too many update download redirects");
        }

        if download_host_is_allowed(attempt.url().host_str()) {
            attempt.follow()
        } else {
            attempt.error("update download redirected to an untrusted host")
        }
    });

    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(180))
        .redirect(redirect_policy)
        .user_agent("Smart-Preload-Native-Updater")
        .build()
        .context("failed to create app update download client")
}

pub(super) async fn download_manifest(
    client: &reqwest::Client,
    url: &str,
    destination: &Path,
) -> Result<()> {
    download_file(client, url, destination, MAX_MANIFEST_BYTES).await
}

pub(super) async fn download_archive(
    client: &reqwest::Client,
    url: &str,
    destination: &Path,
) -> Result<()> {
    download_file(client, url, destination, MAX_APP_ARCHIVE_BYTES).await
}

async fn download_file(
    client: &reqwest::Client,
    url: &str,
    destination: &Path,
    max_bytes: u64,
) -> Result<()> {
    let mut response = client
        .get(url)
        .send()
        .await
        .with_context(|| format!("failed to request {url}"))?
        .error_for_status()
        .with_context(|| format!("update asset request failed for {url}"))?;

    if response
        .content_length()
        .is_some_and(|length| length > max_bytes)
    {
        bail!("update asset exceeds the allowed download size");
    }

    let mut file = tokio::fs::File::create(destination)
        .await
        .with_context(|| format!("failed to create {}", destination.display()))?;
    let mut written = 0_u64;

    while let Some(chunk) = response
        .chunk()
        .await
        .context("failed to read update download")?
    {
        written = written
            .checked_add(chunk.len() as u64)
            .ok_or_else(|| anyhow::anyhow!("update asset size overflow"))?;
        if written > max_bytes {
            bail!("update asset exceeds the allowed download size");
        }
        file.write_all(&chunk)
            .await
            .context("failed to write update download")?;
    }

    if written == 0 {
        bail!("downloaded update asset is empty");
    }
    file.flush().await?;
    file.sync_all().await?;
    Ok(())
}

fn download_host_is_allowed(host: Option<&str>) -> bool {
    let Some(host) = host else {
        return false;
    };
    host.eq_ignore_ascii_case("github.com")
        || host
            .to_ascii_lowercase()
            .ends_with(".githubusercontent.com")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redirect_policy_accepts_only_github_download_hosts() {
        assert!(download_host_is_allowed(Some("github.com")));
        assert!(download_host_is_allowed(Some(
            "release-assets.githubusercontent.com"
        )));
        assert!(!download_host_is_allowed(Some("github.com.example.test")));
        assert!(!download_host_is_allowed(Some(
            "release-assets.githubusercontent.com.example.test"
        )));
    }
}
