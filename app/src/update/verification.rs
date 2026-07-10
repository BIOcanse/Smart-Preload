use std::collections::BTreeSet;
use std::fs::{self, File, OpenOptions};
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use anyhow::{bail, Context, Result};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use rsa::pkcs1v15::{Signature as RsaSignature, VerifyingKey};
use rsa::signature::Verifier;
use rsa::{BigUint, RsaPublicKey};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use zip::ZipArchive;

const MAX_ARCHIVE_ENTRIES: usize = 128;
const MAX_UNCOMPRESSED_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;
const SIGNING_PUBLIC_KEY_JSON: &str = include_str!("signing-public.json");
const SIGNATURE_ALGORITHM: &str = "rsa-pkcs1-sha256";

const ALLOWED_TOP_LEVEL_ENTRIES: &[&str] = &[
    "LICENSE",
    "NOTICE",
    "README.md",
    "START-HERE.md",
    "VERSION.txt",
    "install-register.cmd",
    "install-register.ps1",
    "portable",
    "zero-latency-web-app.exe",
];

const REQUIRED_FILES: &[&str] = &[
    "README.md",
    "VERSION.txt",
    "install-register.cmd",
    "install-register.ps1",
    "zero-latency-web-app.exe",
];

pub(super) fn verify_and_extract(
    archive_path: &Path,
    manifest_path: &Path,
    signature_path: &Path,
    asset_name: &str,
    destination: &Path,
    target_version: &str,
) -> Result<()> {
    verify_manifest_signature(manifest_path, signature_path)?;
    verify_download_hash(archive_path, manifest_path, asset_name)?;
    extract_verified_archive(archive_path, destination, target_version)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SigningPublicKey {
    schema_version: u32,
    algorithm: String,
    key_id: String,
    modulus: String,
    exponent: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManifestSignature {
    schema_version: u32,
    algorithm: String,
    key_id: String,
    signature: String,
}

fn verify_manifest_signature(manifest_path: &Path, signature_path: &Path) -> Result<()> {
    let public_key: SigningPublicKey = serde_json::from_str(SIGNING_PUBLIC_KEY_JSON)
        .context("embedded app update signing key is invalid")?;
    let signature: ManifestSignature = serde_json::from_slice(
        &fs::read(signature_path).context("failed to read app update manifest signature")?,
    )
    .context("app update manifest signature payload is invalid")?;

    if public_key.schema_version != 1
        || signature.schema_version != 1
        || public_key.algorithm != SIGNATURE_ALGORITHM
        || signature.algorithm != SIGNATURE_ALGORITHM
        || public_key.key_id != signature.key_id
    {
        bail!("app update manifest signature metadata does not match the trusted key");
    }

    let modulus = BASE64_STANDARD
        .decode(public_key.modulus)
        .context("embedded app update signing modulus is invalid")?;
    let exponent = BASE64_STANDARD
        .decode(public_key.exponent)
        .context("embedded app update signing exponent is invalid")?;
    let signature_bytes = BASE64_STANDARD
        .decode(signature.signature)
        .context("app update manifest signature is not valid base64")?;
    let rsa_key = RsaPublicKey::new(
        BigUint::from_bytes_be(&modulus),
        BigUint::from_bytes_be(&exponent),
    )
    .context("embedded app update signing key is not a valid RSA key")?;
    let signature = RsaSignature::try_from(signature_bytes.as_slice())
        .context("app update manifest signature has an invalid length")?;
    let manifest = fs::read(manifest_path).context("failed to read signed app update manifest")?;

    VerifyingKey::<Sha256>::new(rsa_key)
        .verify(&manifest, &signature)
        .context("app update manifest signature verification failed")
}

fn verify_download_hash(archive_path: &Path, manifest_path: &Path, asset_name: &str) -> Result<()> {
    let manifest =
        fs::read_to_string(manifest_path).context("failed to read app update hash manifest")?;
    let expected = parse_hash_manifest(&manifest, asset_name)?;
    let actual = sha256_file(archive_path)?;

    if !constant_time_equal(&expected, &actual) {
        bail!("app update archive SHA-256 does not match the release manifest");
    }

    Ok(())
}

fn parse_hash_manifest(contents: &str, asset_name: &str) -> Result<[u8; 32]> {
    let lines: Vec<&str> = contents
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    if lines.len() != 1 {
        bail!("app update hash manifest must contain exactly one entry");
    }

    let mut fields = lines[0].split_whitespace();
    let hash = fields
        .next()
        .ok_or_else(|| anyhow::anyhow!("app update hash manifest is missing a SHA-256 value"))?;
    let filename = fields
        .next()
        .ok_or_else(|| anyhow::anyhow!("app update hash manifest is missing an asset name"))?;
    if fields.next().is_some() || filename != asset_name {
        bail!("app update hash manifest does not identify the expected asset");
    }

    decode_sha256(hash)
}

fn decode_sha256(value: &str) -> Result<[u8; 32]> {
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        bail!("app update hash manifest contains an invalid SHA-256 value");
    }

    let mut decoded = [0_u8; 32];
    for (index, output) in decoded.iter_mut().enumerate() {
        let offset = index * 2;
        *output = u8::from_str_radix(&value[offset..offset + 2], 16)
            .context("app update hash manifest contains invalid hexadecimal data")?;
    }
    Ok(decoded)
}

fn sha256_file(path: &Path) -> Result<[u8; 32]> {
    let mut file = File::open(path).context("failed to open app update archive for hashing")?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];

    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }

    Ok(hasher.finalize().into())
}

fn constant_time_equal(left: &[u8; 32], right: &[u8; 32]) -> bool {
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn extract_verified_archive(
    archive_path: &Path,
    destination: &Path,
    target_version: &str,
) -> Result<()> {
    validate_archive_layout(archive_path)?;
    fs::create_dir(destination).with_context(|| {
        format!(
            "failed to create verified incoming directory {}",
            destination.display()
        )
    })?;

    let file = File::open(archive_path)?;
    let mut archive =
        ZipArchive::new(file).context("app update asset is not a valid zip archive")?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let relative_path = safe_archive_path(&entry)?;
        let output_path = destination.join(relative_path);

        if entry.is_dir() {
            fs::create_dir_all(&output_path)?;
            continue;
        }

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&output_path)
            .with_context(|| format!("duplicate or invalid archive entry: {}", entry.name()))?;
        std::io::copy(&mut entry, &mut output)?;
        output.sync_all()?;
    }

    validate_extracted_package(destination, target_version)
}

fn validate_archive_layout(archive_path: &Path) -> Result<()> {
    let file = File::open(archive_path)?;
    let mut archive =
        ZipArchive::new(file).context("app update asset is not a valid zip archive")?;
    if archive.is_empty() || archive.len() > MAX_ARCHIVE_ENTRIES {
        bail!("app update archive has an invalid entry count");
    }

    let mut normalized_entries = BTreeSet::new();
    let mut top_level_entries = BTreeSet::new();
    let mut uncompressed_size = 0_u64;

    for index in 0..archive.len() {
        let entry = archive.by_index(index)?;
        let relative_path = safe_archive_path(&entry)?;
        let normalized = relative_path
            .to_string_lossy()
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_ascii_lowercase();
        if normalized.is_empty() || !normalized_entries.insert(normalized) {
            bail!("app update archive contains duplicate or empty paths");
        }

        let top_level = relative_path
            .components()
            .next()
            .and_then(|component| match component {
                Component::Normal(value) => value.to_str(),
                _ => None,
            })
            .ok_or_else(|| anyhow::anyhow!("app update archive contains an invalid path"))?;
        if !ALLOWED_TOP_LEVEL_ENTRIES.contains(&top_level) {
            bail!("app update archive contains unexpected top-level entry: {top_level}");
        }
        top_level_entries.insert(top_level.to_string());

        uncompressed_size = uncompressed_size
            .checked_add(entry.size())
            .ok_or_else(|| anyhow::anyhow!("app update archive size overflow"))?;
        if uncompressed_size > MAX_UNCOMPRESSED_ARCHIVE_BYTES {
            bail!("app update archive expands beyond the allowed size");
        }
    }

    for required in REQUIRED_FILES {
        if !top_level_entries.contains(*required) {
            bail!("app update archive is missing required file: {required}");
        }
    }
    if !top_level_entries.contains("portable") {
        bail!("app update archive is missing the portable data directory");
    }

    Ok(())
}

fn safe_archive_path(entry: &zip::read::ZipFile<'_>) -> Result<PathBuf> {
    if entry.name().contains('\\')
        || entry.name().contains('\0')
        || entry
            .name()
            .split('/')
            .any(|component| matches!(component, "." | ".."))
    {
        bail!("app update archive contains a non-canonical path");
    }
    if entry
        .unix_mode()
        .is_some_and(|mode| mode & 0o170000 == 0o120000)
    {
        bail!("app update archive contains a symbolic link");
    }

    let path = entry
        .enclosed_name()
        .ok_or_else(|| anyhow::anyhow!("app update archive contains an unsafe path"))?;
    for component in path.components() {
        let Component::Normal(component) = component else {
            bail!("app update archive contains a non-relative path");
        };
        let component = component
            .to_str()
            .ok_or_else(|| anyhow::anyhow!("app update archive path is not valid Unicode"))?;
        if !archive_component_is_safe(component) {
            bail!("app update archive contains an unsafe Windows filename");
        }
    }
    Ok(path.to_path_buf())
}

fn archive_component_is_safe(component: &str) -> bool {
    let stem = component.split('.').next().unwrap_or_default();
    let reserved_device_name = matches!(
        stem.to_ascii_uppercase().as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    );

    !component.is_empty()
        && component
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        && !component.ends_with('.')
        && !reserved_device_name
}

fn validate_extracted_package(destination: &Path, target_version: &str) -> Result<()> {
    for required in REQUIRED_FILES {
        if !destination.join(required).is_file() {
            bail!("verified app update is missing required file: {required}");
        }
    }
    if !destination.join("portable").is_dir() {
        bail!("verified app update is missing the portable data directory");
    }

    let package_version = fs::read_to_string(destination.join("VERSION.txt"))?;
    if package_version.trim() != target_version {
        bail!(
            "app update package version {} does not match target {target_version}",
            package_version.trim()
        );
    }

    let mut executable = File::open(destination.join("zero-latency-web-app.exe"))?;
    let mut executable_header = [0_u8; 2];
    executable.read_exact(&mut executable_header)?;
    if executable_header != *b"MZ" {
        bail!("app update executable does not have a Windows PE header");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};

    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    use super::*;

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn hash_mismatch_fails_before_archive_validation() {
        let root = temporary_test_directory("hash-mismatch");
        let archive = root.join("app.zip");
        let manifest = root.join("app.zip.sha256.txt");
        fs::write(&archive, b"not the expected bytes").expect("write archive");
        fs::write(&manifest, format!("{}  app.zip\n", "00".repeat(32))).expect("write manifest");

        let error = verify_download_hash(&archive, &manifest, "app.zip")
            .expect_err("hash mismatch must fail");
        assert!(error.to_string().contains("does not match"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn untrusted_manifest_signature_is_rejected() {
        let root = temporary_test_directory("signature-mismatch");
        let manifest = root.join("app.zip.sha256.txt");
        let signature = root.join("app.zip.sha256.txt.sig");
        fs::write(&manifest, format!("{}  app.zip\n", "00".repeat(32))).expect("write manifest");
        fs::write(
            &signature,
            r#"{"schemaVersion":1,"algorithm":"rsa-pkcs1-sha256","keyId":"untrusted","signature":"AA=="}"#,
        )
        .expect("write signature");

        let error = verify_manifest_signature(&manifest, &signature)
            .expect_err("untrusted signature must fail");
        assert!(error.to_string().contains("trusted key"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn trusted_manifest_signature_is_accepted() {
        let root = temporary_test_directory("signature-valid");
        let manifest = root.join("app.zip.sha256.txt");
        let signature = root.join("app.zip.sha256.txt.sig");
        fs::write(
            &manifest,
            b"e4944cc6826c0082cb83effc532d990a0b38da5e304b6b37a4f6067ef43987e8  zero-latency-web-app-windows-x64-v9.9.9.zip\r\n",
        )
        .expect("write signed manifest fixture");
        fs::write(
            &signature,
            concat!(
                r#"{"schemaVersion":1,"algorithm":"rsa-pkcs1-sha256","keyId":"34c863867d00db937a4e87ae6c4e1d96","signature":""#,
                "qGxkF6+s1Hkeam+fVf5ISHSLXrrDwrsBfwfbqQ1DyUIcWwNRYb+cTK8L4LDTSQZS43gDLX39vEBJ9glJoWDf3+JmpFoadU07hZrdcg5ZqOkfLWJWj7q3JMv4K2c0tDpn0V4a6mSLBF+CMAkEiBtRftssH+7dT96thMtKXLJYAruqIZZmqunE/TIpebnou0efb7yFDIhnJ0Wk1xtj7dIOGcdojtBpQ7goHzJmDHB5BQfQTZse3FN2vlX+RYBDTmGsssxPJqTtwzH+zybnTQYApLFKDS6PENQdccsvQAp6uNtDTVJo3lfeOFYlFmMip8BbZ7y7XMv+sBImdyq3lE1XCPVM6plqwGyJcBQBuZSjb1F3Lkp9/nasuXdsFSP4JkU1vjza1FOiqsdKU4v+nMeHCU7t2mj216hHWfp8uVRIBn4DjPl4B8H3wV/HBdpdJgovGPLbEB2yw43Rn09Ejpz4/wb9sfjscu4J3I9DOKRPVx88zuywDJBKzymCZJ3eqHIq",
                r#""}"#
            ),
        )
        .expect("write signature fixture");

        verify_manifest_signature(&manifest, &signature)
            .expect("trusted production-key signature must verify");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn malformed_or_ambiguous_manifests_are_rejected() {
        assert!(parse_hash_manifest("not-a-hash app.zip", "app.zip").is_err());
        assert!(parse_hash_manifest(
            &format!(
                "{}  app.zip\n{}  app.zip\n",
                "00".repeat(32),
                "00".repeat(32)
            ),
            "app.zip"
        )
        .is_err());
        assert!(
            parse_hash_manifest(&format!("{}  other.zip", "00".repeat(32)), "app.zip").is_err()
        );
    }

    #[test]
    fn incomplete_app_asset_is_rejected_without_creating_destination() {
        let root = temporary_test_directory("bad-asset");
        let archive = root.join("bad.zip");
        write_zip(&archive, &[("VERSION.txt", b"1.2.3")]);
        let destination = root.join("incoming");

        let error = extract_verified_archive(&archive, &destination, "1.2.3")
            .expect_err("incomplete package must fail");
        assert!(error.to_string().contains("missing required"));
        assert!(!destination.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn canonical_app_asset_extracts_after_validation() {
        let root = temporary_test_directory("valid-asset");
        let archive = root.join("valid.zip");
        write_valid_app_zip(&archive, "1.2.3");
        let destination = root.join("incoming");

        extract_verified_archive(&archive, &destination, "1.2.3")
            .expect("canonical package must extract");
        assert!(destination.join("zero-latency-web-app.exe").is_file());
        assert!(destination.join("portable/native-messaging").is_dir());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn unsafe_archive_paths_are_rejected() {
        let root = temporary_test_directory("unsafe-asset");
        let archive = root.join("unsafe.zip");
        write_zip(&archive, &[("../outside.txt", b"escape")]);

        let error = validate_archive_layout(&archive).expect_err("unsafe path must fail");
        assert!(
            error.to_string().contains("path"),
            "unexpected validation error: {error}"
        );
        let _ = fs::remove_dir_all(root);
    }

    fn temporary_test_directory(label: &str) -> PathBuf {
        let sequence = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "smart-preload-verification-{label}-{}-{sequence}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("create test directory");
        path
    }

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = File::create(path).expect("create zip");
        let mut writer = ZipWriter::new(file);
        for (name, contents) in entries {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .expect("start zip entry");
            writer.write_all(contents).expect("write zip entry");
        }
        writer.finish().expect("finish zip");
    }

    fn write_valid_app_zip(path: &Path, version: &str) {
        let file = File::create(path).expect("create zip");
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        for (name, contents) in [
            ("README.md", b"readme".as_slice()),
            ("VERSION.txt", version.as_bytes()),
            ("install-register.cmd", b"@exit /b 0".as_slice()),
            ("install-register.ps1", b"exit 0".as_slice()),
            ("zero-latency-web-app.exe", b"MZfixture".as_slice()),
        ] {
            writer.start_file(name, options).expect("start zip entry");
            writer.write_all(contents).expect("write zip entry");
        }
        writer
            .add_directory("portable/native-messaging/", options)
            .expect("add portable directory");
        writer.finish().expect("finish zip");
    }
}
