// TEST-REQUIRES: local-secrets
//
// 这个测试要真的签一份更新清单，再用 app 内嵌的**生产公钥**
// （app/src/update/signing-public.json）验签。也就是说它需要对应的生产私钥
// %USERPROFILE%\.smart-preload-release\app-update-signing-private.json ——
// 那把钥匙只在维护者本机，也**不应该**出现在 CI 上。
//
// 所以它不是「CI 上恰好跑不了」，是「CI 上不该跑」。run-all.mjs 按上面这行标记把它
// 归到 local-secrets；CI 用 --no-local-secrets 显式排除，见 .github/workflows/ci.yml。
// 换成临时生成的密钥就失去意义了：真正要验的正是「发布用的那把私钥签出来的东西，
// 装机的 app 能验过」。
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
import {
  createWindowsPowerShellEnv,
  WINDOWS_POWERSHELL,
} from "./lib/windows-powershell.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const temporaryRoot = mkdtempSync(path.join(tmpdir(), "smart-preload-updater-test-"));
const windowsPowerShellEnv = createWindowsPowerShellEnv();

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
      env: windowsPowerShellEnv,
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
      env: windowsPowerShellEnv,
      timeout: 5_000,
      windowsHide: true,
    }
  );
  assert.equal(propagatedExit.status, 23, "batch wrapper must preserve installer exit status");

  const hiddenHandoffExit = spawnSync(
    WINDOWS_POWERSHELL,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$process = Start-Process -FilePath $env:ZLW_TEST_INSTALLER -ArgumentList '--unattended' -WorkingDirectory $env:ZLW_TEST_INSTALLER_DIR -WindowStyle Hidden -Wait -PassThru; exit $process.ExitCode",
    ],
    {
      encoding: "utf8",
      env: createWindowsPowerShellEnv({
        ...process.env,
        ZLW_TEST_INSTALLER: path.join(installerDirectory, "install-register.cmd"),
        ZLW_TEST_INSTALLER_DIR: installerDirectory,
      }),
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
    WINDOWS_POWERSHELL,
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
      env: windowsPowerShellEnv,
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
    WINDOWS_POWERSHELL,
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
      env: windowsPowerShellEnv,
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
    WINDOWS_POWERSHELL,
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
      env: windowsPowerShellEnv,
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
