use std::cmp::Ordering;

use anyhow::{bail, Result};

pub(crate) const APP_ASSET_PREFIX: &str = "zero-latency-web-app-windows-x64-v";
pub(crate) const APP_ASSET_SUFFIX: &str = ".zip";
const RELEASE_TAG_URL_PREFIX: &str = "https://github.com/BIOcanse/Smart-Preload/releases/tag/";
const ASSET_URL_PREFIX: &str = "https://github.com/BIOcanse/Smart-Preload/releases/download/";

#[derive(Clone, Debug)]
pub(crate) struct UpdateRequest {
    pub(crate) target_version: String,
    pub(crate) asset_name: String,
    pub(crate) asset_url: String,
    pub(crate) release_url: String,
}

#[derive(Clone, Debug)]
pub(crate) struct ValidatedUpdate {
    pub(crate) target_version: String,
    pub(crate) release_tag: String,
    pub(crate) asset_name: String,
    pub(crate) asset_url: String,
    pub(crate) manifest_name: String,
    pub(crate) manifest_url: String,
    pub(crate) signature_name: String,
    pub(crate) signature_url: String,
}

pub(crate) fn validate_update_request(
    request: UpdateRequest,
    current_version: &str,
) -> Result<ValidatedUpdate> {
    let target_version = normalize_version(&request.target_version)
        .ok_or_else(|| anyhow::anyhow!("invalid target version"))?;
    let current_version = normalize_version(current_version)
        .ok_or_else(|| anyhow::anyhow!("invalid running app version"))?;

    if compare_versions(&target_version, &current_version) != Ordering::Greater {
        bail!("target version must be newer than the running app version");
    }

    let expected_asset_name = format!("{APP_ASSET_PREFIX}{target_version}{APP_ASSET_SUFFIX}");
    if request.asset_name != expected_asset_name {
        bail!("asset name does not match target version");
    }

    let asset_path = request
        .asset_url
        .strip_prefix(ASSET_URL_PREFIX)
        .ok_or_else(|| anyhow::anyhow!("asset URL is not an expected GitHub release asset"))?;
    let (release_tag, asset_name) = asset_path
        .split_once('/')
        .ok_or_else(|| anyhow::anyhow!("asset URL is missing a release tag"))?;

    if asset_name != expected_asset_name || asset_name.contains('/') {
        bail!("asset URL does not identify the expected app asset");
    }

    if normalize_version(release_tag).as_deref() != Some(target_version.as_str()) {
        bail!("asset release tag does not match target version");
    }

    let expected_release_url = format!("{RELEASE_TAG_URL_PREFIX}{release_tag}");
    if request.release_url.trim_end_matches('/') != expected_release_url {
        bail!("release URL does not match the app asset release tag");
    }

    let manifest_name = format!("{expected_asset_name}.sha256.txt");
    let manifest_url = format!("{ASSET_URL_PREFIX}{release_tag}/{manifest_name}");
    let signature_name = format!("{manifest_name}.sig");
    let signature_url = format!("{ASSET_URL_PREFIX}{release_tag}/{signature_name}");

    Ok(ValidatedUpdate {
        target_version,
        release_tag: release_tag.to_string(),
        asset_name: expected_asset_name,
        asset_url: request.asset_url,
        manifest_name,
        manifest_url,
        signature_name,
        signature_url,
    })
}

pub(crate) fn normalize_version(value: &str) -> Option<String> {
    let value = value.trim();
    let trimmed = value.strip_prefix('v').unwrap_or(value);
    let parts: Vec<&str> = trimmed.split('.').collect();

    if parts.len() != 3
        || parts.iter().any(|part| {
            part.is_empty()
                || !part.chars().all(|character| character.is_ascii_digit())
                || part.parse::<u32>().is_err()
                || (part.len() > 1 && part.starts_with('0'))
        })
    {
        return None;
    }

    Some(trimmed.to_string())
}

fn compare_versions(left: &str, right: &str) -> Ordering {
    parse_version_parts(left).cmp(&parse_version_parts(right))
}

fn parse_version_parts(value: &str) -> [u32; 3] {
    let mut parts = [0_u32; 3];

    for (index, part) in value.trim_start_matches('v').split('.').take(3).enumerate() {
        parts[index] = part.parse::<u32>().unwrap_or(0);
    }

    parts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_exact_release_and_manifest_urls() {
        let update = validate_update_request(
            UpdateRequest {
                target_version: "v1.2.3".to_string(),
                asset_name: "zero-latency-web-app-windows-x64-v1.2.3.zip".to_string(),
                asset_url: "https://github.com/BIOcanse/Smart-Preload/releases/download/v1.2.3/zero-latency-web-app-windows-x64-v1.2.3.zip".to_string(),
                release_url: "https://github.com/BIOcanse/Smart-Preload/releases/tag/v1.2.3".to_string(),
            },
            "1.2.2",
        )
        .expect("valid update");

        assert_eq!(update.release_tag, "v1.2.3");
        assert_eq!(
            update.manifest_url,
            "https://github.com/BIOcanse/Smart-Preload/releases/download/v1.2.3/zero-latency-web-app-windows-x64-v1.2.3.zip.sha256.txt"
        );
        assert_eq!(
            update.signature_url,
            "https://github.com/BIOcanse/Smart-Preload/releases/download/v1.2.3/zero-latency-web-app-windows-x64-v1.2.3.zip.sha256.txt.sig"
        );
    }

    #[test]
    fn rejects_cross_release_asset_urls() {
        let error = validate_update_request(
            UpdateRequest {
                target_version: "1.2.3".to_string(),
                asset_name: "zero-latency-web-app-windows-x64-v1.2.3.zip".to_string(),
                asset_url: "https://github.com/BIOcanse/Smart-Preload/releases/download/v9.9.9/zero-latency-web-app-windows-x64-v1.2.3.zip".to_string(),
                release_url: "https://github.com/BIOcanse/Smart-Preload/releases/tag/v9.9.9".to_string(),
            },
            "1.2.2",
        )
        .expect_err("cross-release asset must be rejected");

        assert!(error.to_string().contains("release tag"));
    }

    #[test]
    fn rejects_overflowing_version_parts() {
        assert!(normalize_version("1.4294967296.0").is_none());
        assert!(normalize_version("vv1.2.3").is_none());
        assert!(normalize_version("1.02.3").is_none());
    }
}
