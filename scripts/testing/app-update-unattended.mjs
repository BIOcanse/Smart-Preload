import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "smart-preload-updater-test-"));

try {
  const installerDirectory = path.join(temporaryRoot, "installer");
  mkdirSync(installerDirectory, { recursive: true });
  copyFileSync(
    path.join(repoRoot, "app", "install-register.cmd"),
    path.join(installerDirectory, "install-register.cmd")
  );
  copyFileSync(
    path.join(repoRoot, "app", "install-register.ps1"),
    path.join(installerDirectory, "install-register.ps1")
  );

  const startedAt = Date.now();
  const unattended = spawnSync(
    "cmd.exe",
    ["/d", "/c", path.join(installerDirectory, "install-register.cmd"), "--unattended"],
    {
      cwd: installerDirectory,
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    }
  );
  const elapsedMs = Date.now() - startedAt;

  assert.equal(unattended.error, undefined, unattended.error?.message);
  assert.equal(unattended.status, 1, unattended.stderr || unattended.stdout);
  assert.ok(elapsedMs < 5_000, `unattended installer took ${elapsedMs} ms`);
  assert.doesNotMatch(
    `${unattended.stdout}\n${unattended.stderr}`,
    /Press Enter|Terminate batch job|\[y\/N\]/iu
  );

  writeFileSync(path.join(installerDirectory, "install-register.ps1"), "exit 23\r\n");
  const propagatedExit = spawnSync(
    "cmd.exe",
    ["/d", "/c", path.join(installerDirectory, "install-register.cmd"), "--unattended"],
    {
      cwd: installerDirectory,
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    }
  );
  assert.equal(propagatedExit.status, 23, "batch wrapper must preserve installer exit status");

  const hiddenHandoffExit = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$process = Start-Process -FilePath $env:ZLW_TEST_INSTALLER -ArgumentList '--unattended' -WorkingDirectory $env:ZLW_TEST_INSTALLER_DIR -WindowStyle Hidden -Wait -PassThru; exit $process.ExitCode",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ZLW_TEST_INSTALLER: path.join(installerDirectory, "install-register.cmd"),
        ZLW_TEST_INSTALLER_DIR: installerDirectory,
      },
      timeout: 5_000,
      windowsHide: true,
    }
  );
  assert.equal(
    hiddenHandoffExit.status,
    23,
    "hidden handoff must observe the installer exit status"
  );

  const appZip = path.join(
    temporaryRoot,
    "zero-latency-web-app-windows-x64-v9.8.7.zip"
  );
  const archiveContents = Buffer.from("deterministic update fixture", "utf8");
  writeFileSync(appZip, archiveContents);
  const manifestScript = path.join(
    repoRoot,
    "scripts",
    "release",
    "write-app-update-manifest.ps1"
  );
  const manifestResult = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      manifestScript,
      "-AppZip",
      appZip,
      "-ExpectedVersion",
      "9.8.7",
    ],
    {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    }
  );
  assert.equal(manifestResult.status, 0, manifestResult.stderr || manifestResult.stdout);

  const manifestPath = `${appZip}.sha256.txt`;
  const signaturePath = `${manifestPath}.sig`;
  const expectedHash = createHash("sha256").update(archiveContents).digest("hex");
  assert.equal(readFileSync(manifestPath, "ascii"), `${expectedHash}  ${path.basename(appZip)}\r\n`);
  const firstSignature = readSignature(signaturePath);
  assert.equal(firstSignature.algorithm, "rsa-pkcs1-sha256");
  assert.equal(verifyManifestSignature(manifestPath, firstSignature), true);

  const replacementContents = Buffer.from("replacement fixture", "utf8");
  writeFileSync(appZip, replacementContents);
  const replacementManifest = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      manifestScript,
      "-AppZip",
      appZip,
      "-ExpectedVersion",
      "9.8.7",
    ],
    {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    }
  );
  assert.equal(
    replacementManifest.status,
    0,
    replacementManifest.stderr || replacementManifest.stdout
  );
  const replacementHash = createHash("sha256").update(replacementContents).digest("hex");
  assert.equal(
    readFileSync(manifestPath, "ascii"),
    `${replacementHash}  ${path.basename(appZip)}\r\n`
  );
  const replacementSignature = readSignature(signaturePath);
  assert.notEqual(replacementSignature.signature, firstSignature.signature);
  assert.equal(verifyManifestSignature(manifestPath, replacementSignature), true);
  writeFileSync(manifestPath, `00${readFileSync(manifestPath, "ascii").slice(2)}`, "ascii");
  assert.equal(
    verifyManifestSignature(manifestPath, replacementSignature),
    false,
    "manifest tampering must invalidate the detached signature"
  );

  const wrongVersion = spawnSync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      manifestScript,
      "-AppZip",
      appZip,
      "-ExpectedVersion",
      "9.8.8",
    ],
    {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    }
  );
  assert.notEqual(wrongVersion.status, 0, "manifest generator must reject version mismatch");

  console.log("app updater unattended and manifest tests passed");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function readSignature(signaturePath) {
  return JSON.parse(readFileSync(signaturePath, "ascii"));
}

function verifyManifestSignature(manifestPath, signature) {
  const publicKey = JSON.parse(
    readFileSync(path.join(repoRoot, "app", "src", "update", "signing-public.json"), "utf8")
  );
  const key = createPublicKey({
    format: "jwk",
    key: {
      kty: "RSA",
      n: toBase64Url(publicKey.modulus),
      e: toBase64Url(publicKey.exponent),
    },
  });
  return verify(
    "RSA-SHA256",
    readFileSync(manifestPath),
    key,
    Buffer.from(signature.signature, "base64")
  );
}

function toBase64Url(value) {
  return Buffer.from(value, "base64").toString("base64url");
}
