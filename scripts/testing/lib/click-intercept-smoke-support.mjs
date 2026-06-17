import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { CdpClient } from "./cdp-client.mjs";
import { prepareExtensionUnderTest as copyExtensionFixture } from "./extension-fixture.mjs";
import { waitForZeroLatencyExtensionServiceWorker } from "./extension-service-worker.mjs";
import { escapeHtml, fetchJson, sleep } from "./test-utils.mjs";

export async function waitForClickInterceptExtensionServiceWorker(
  debugPort,
  timeoutMs = 20000
) {
  return waitForZeroLatencyExtensionServiceWorker({
    debugPort,
    timeoutMs,
    requiredPermissions: ["nativeMessaging", "bookmarks", "tabs", "windows"],
  });
}

export function launchClickInterceptChrome({
  chromiumPath,
  debugPort,
  extensionUnderTestDir,
  profileDir,
  scenarios,
}) {
  if (!chromiumPath || !existsSync(chromiumPath)) {
    throw new Error("Playwright Chromium executable was not found.");
  }

  const resolverRules = [...new Set(scenarios.flatMap((scenario) => [
    scenario.sourceHost,
    scenario.targetHost,
  ]))]
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
    "--proxy-server=direct://",
    "--proxy-bypass-list=*",
    "--no-first-run",
    "--no-sandbox",
    "--no-default-browser-check",
    "--disable-default-apps",
    "--disable-sync",
    "--disable-popup-blocking",
    "--disable-features=Translate,AutofillServerCommunication,DisableLoadExtensionCommandLineSwitch",
    "--window-size=1280,900",
    `${scenarios[0].sourceUrl}?startup=1`,
  ];

  const child = spawn(chromiumPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

export async function closeClickInterceptChrome({ chrome, debugPort }) {
  try {
    const version = await fetchJson(`http://127.0.0.1:${debugPort}/json/version`);
    if (version?.webSocketDebuggerUrl) {
      const browser = await CdpClient.connect(version.webSocketDebuggerUrl);
      try {
        await browser.send("Browser.close");
      } finally {
        browser.close();
      }
    }
  } catch (_error) {
    // Fall back to terminating the launcher process below.
  }

  if (!chrome.killed) {
    try {
      chrome.kill();
    } catch (_error) {
      // Ignore process cleanup errors.
    }
  }

  await waitForProcessExit(chrome, 5000);
}

export async function prepareClickInterceptExtension({ extensionDir, targetDir }) {
  await copyExtensionFixture({
    extensionDir,
    targetDir,
  });
}

export async function startClickInterceptServer(port, scenarios) {
  const scenarioBySourcePath = new Map(
    scenarios.map((scenario) => [`${scenario.sourceHost}/source/${scenario.id}`, scenario])
  );
  const scenarioByTargetPath = new Map(
    scenarios.map((scenario) => [`${scenario.targetHost}/target/${scenario.id}`, scenario])
  );

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host}`);
    const host = (request.headers.host || "").split(":")[0];
    const key = `${host}${requestUrl.pathname}`;
    response.setHeader("Cache-Control", "no-store");

    if (scenarioBySourcePath.has(key)) {
      respondHtml(response, renderSourcePage(scenarioBySourcePath.get(key)));
      return;
    }

    if (scenarioByTargetPath.has(key)) {
      respondHtml(response, renderTargetPage(scenarioByTargetPath.get(key)));
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("not found");
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return server;
}

async function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(timeoutMs),
  ]);
}

function renderSourcePage(scenario) {
  const targetAttr = scenario.targetHint === "_blank" ? ' target="_blank"' : "";
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Source ${scenario.id}</title>
    <style>
      body { font-family: sans-serif; margin: 40px; }
      a { display: inline-block; padding: 18px 24px; font-size: 20px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Source ${scenario.id}</h1>
      <a id="target-link" href="${escapeHtml(scenario.targetUrl)}"${targetAttr}>Open target ${scenario.id}</a>
    </main>
  </body>
</html>`;
}

function renderTargetPage(scenario) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Target ${scenario.id}</title>
  </head>
  <body>
    <main>
      <h1 id="target-marker">Target ${scenario.id}</h1>
      <p>${escapeHtml(scenario.targetUrl)}</p>
    </main>
  </body>
</html>`;
}

function respondHtml(response, html) {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}
