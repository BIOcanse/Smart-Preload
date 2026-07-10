import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { prepareExtensionUnderTest as copyExtensionFixture } from "./extension-fixture.mjs";
import { waitForZeroLatencyExtensionServiceWorker } from "./extension-service-worker.mjs";

const BOOKMARK_SMOKE_HOSTS = [
  "www.google.test",
  "bookmark-high.test",
  "bookmark-mid.test",
  "bookmark-low.test",
  "page-result.test",
  "nongoogle.test",
];

export function launchBookmarkSmokeChrome({
  browserPathCandidates,
  debugPort,
  extensionUnderTestDir,
  profileDir,
  webPort,
}) {
  const browserPath = browserPathCandidates.find(
    (candidate) => candidate && existsSync(candidate)
  );
  if (!browserPath) {
    throw new Error("Playwright Chromium executable was not found.");
  }

  const resolverRules = BOOKMARK_SMOKE_HOSTS
    .map((host) => `MAP ${host} 127.0.0.1`)
    .join(", ");
  const args = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${debugPort}`,
    `--disable-extensions-except=${extensionUnderTestDir}`,
    `--load-extension=${extensionUnderTestDir}`,
    "--enable-extensions",
    "--enable-unsafe-extension-debugging",
    `--host-resolver-rules=${resolverRules}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--no-sandbox",
    "--disable-default-apps",
    "--disable-sync",
    "--disable-features=Translate,AutofillServerCommunication,DisableLoadExtensionCommandLineSwitch",
    "--window-size=1280,900",
    `http://www.google.test:${webPort}/search?q=startup-smoke`,
  ];

  const child = spawn(browserPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  });

  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

export async function prepareBookmarkExtensionUnderTest({ extensionDir, targetDir }) {
  await copyExtensionFixture({
    extensionDir,
    targetDir,
  });
}

export async function waitForBookmarkExtensionServiceWorker(debugPort, timeoutMs = 20000) {
  return waitForZeroLatencyExtensionServiceWorker({
    debugPort,
    timeoutMs,
    requiredPermissions: ["nativeMessaging", "bookmarks", "storage"],
  });
}
