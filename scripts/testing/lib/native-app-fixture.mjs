import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { sleep } from "./test-utils.mjs";

export function createNativeAppFixture({
  appDir,
  debugApiOrigin = "http://127.0.0.1:45831",
} = {}) {
  if (!appDir) {
    throw new Error("appDir is required for native app fixture.");
  }

  const appExe = path.join(appDir, "zero-latency-web-app.exe");
  const portableDir = path.join(appDir, "portable");
  const allowedOriginPath = path.join(portableDir, "allowed-extension-origin.txt");
  const allowedOriginsPath = path.join(portableDir, "allowed-extension-origins.txt");
  const debugTokenPath = path.join(portableDir, "debug-api-token.txt");

  return {
    appDir,
    appExe,
    hasExecutable: () => existsSync(appExe),
    launchHost: () => launchHost({ appDir, appExe }),
    fetchDebugJson: (pathname, debugToken) =>
      fetchDebugJson({ debugApiOrigin, pathname, debugToken }),
    waitForHealth: (debugToken, timeoutMs) =>
      waitForHealth({ debugApiOrigin, debugToken, timeoutMs }),
    backupPortableFiles: () =>
      backupPortableFiles({
        allowedOriginPath,
        allowedOriginsPath,
        debugTokenPath,
      }),
    restorePortableFiles: (backups) =>
      restorePortableFiles({
        allowedOriginPath,
        allowedOriginsPath,
        debugTokenPath,
        backups,
      }),
    writePortableTestAccess: (origins, debugToken) =>
      writePortableTestAccess({
        allowedOriginPath,
        allowedOriginsPath,
        debugTokenPath,
        portableDir,
        origins,
        debugToken,
      }),
  };
}

async function fetchDebugJson({ debugApiOrigin, pathname, debugToken }) {
  const response = await fetch(`${debugApiOrigin}${pathname}`, {
    method: pathname.includes("monitor-snapshot") ? "POST" : "GET",
    headers: {
      "X-ZLW-Debug-Token": debugToken,
      Origin: debugApiOrigin,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${pathname}`);
  }

  return response.json();
}

async function waitForHealth({ debugApiOrigin, debugToken, timeoutMs = 12000 }) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await fetchDebugJson({ debugApiOrigin, pathname: "/health", debugToken });
    } catch (error) {
      lastError = error;
      await sleep(250);
    }
  }

  throw lastError || new Error("native app health timeout");
}

function launchHost({ appDir, appExe }) {
  const child = spawn(appExe, ["--host"], {
    cwd: appDir,
    env: {
      ...process.env,
      ZLW_DEBUG_FORCE_HOST: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function backupPortableFiles({
  allowedOriginPath,
  allowedOriginsPath,
  debugTokenPath,
}) {
  return {
    allowedOrigin: await readMaybe(allowedOriginPath),
    allowedOrigins: await readMaybe(allowedOriginsPath),
    debugToken: await readMaybe(debugTokenPath),
  };
}

async function writePortableTestAccess({
  allowedOriginPath,
  allowedOriginsPath,
  debugTokenPath,
  portableDir,
  origins,
  debugToken,
}) {
  await mkdir(portableDir, { recursive: true });
  const existingOrigins = [
    ...((await readMaybe(allowedOriginPath)) ?? "").split(/\r?\n/),
    ...((await readMaybe(allowedOriginsPath)) ?? "").split(/\r?\n/),
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  const nextOrigins = [...new Set([...existingOrigins, ...origins])].join("\n") + "\n";
  await writeFile(allowedOriginPath, nextOrigins, "utf8");
  await writeFile(allowedOriginsPath, nextOrigins, "utf8");
  await writeFile(debugTokenPath, `${debugToken}\n`, "utf8");
}

async function restorePortableFiles({
  allowedOriginPath,
  allowedOriginsPath,
  debugTokenPath,
  backups = {},
}) {
  await restoreMaybe(allowedOriginPath, backups.allowedOrigin);
  await restoreMaybe(allowedOriginsPath, backups.allowedOrigins);
  await restoreMaybe(debugTokenPath, backups.debugToken);
}

async function readMaybe(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (_error) {
    return null;
  }
}

async function restoreMaybe(filePath, contents) {
  if (contents !== null && contents !== undefined) {
    await writeFile(filePath, contents, "utf8");
    return;
  }

  await rm(filePath, { force: true });
}
