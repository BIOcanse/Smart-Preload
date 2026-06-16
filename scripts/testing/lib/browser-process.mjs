import { spawn } from "node:child_process";
import { CdpClient } from "./cdp-client.mjs";
import { fetchJson, sleep } from "./test-utils.mjs";

export function spawnBrowser(executablePath, args, options = {}) {
  const child = spawn(executablePath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: options.windowsHide ?? false,
    cwd: options.cwd,
    env: options.env,
  });

  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

export function buildExtensionBrowserArgs({
  profileDir,
  debugPort,
  extensionDir,
  resolverRules = "",
  startUrl,
  windowSize = "1280,900",
  extraArgs = [],
}) {
  return [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${debugPort}`,
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    "--enable-extensions",
    "--enable-unsafe-extension-debugging",
    ...(resolverRules ? [`--host-resolver-rules=${resolverRules}`] : []),
    "--no-first-run",
    "--no-sandbox",
    "--no-default-browser-check",
    "--disable-default-apps",
    "--disable-sync",
    "--disable-popup-blocking",
    "--disable-features=Translate,AutofillServerCommunication,DisableLoadExtensionCommandLineSwitch",
    "--proxy-server=direct://",
    "--proxy-bypass-list=*",
    `--window-size=${windowSize}`,
    ...extraArgs,
    startUrl,
  ];
}

export async function closeBrowserByDebugPort({ child, debugPort }) {
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

  await stopProcess(child);
}

export async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  const pid = child.pid;

  try {
    child.kill();
  } catch (_error) {
    // Ignore cleanup errors.
  }

  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(5000)]);

  if (process.platform === "win32" && pid) {
    await new Promise((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("exit", resolve);
      killer.once("error", resolve);
    });
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(3000)]);
  }
}

export async function killBrowserProcessesForProfile(commandLineNeedle) {
  if (process.platform !== "win32" || !commandLineNeedle) {
    return;
  }

  const escapedProfileDir = commandLineNeedle.replaceAll("'", "''");
  const command = [
    "$needle = '" + escapedProfileDir + "';",
    "Get-CimInstance Win32_Process -Filter \"name='chrome.exe' or name='msedge.exe'\" |",
    "Where-Object { $_.CommandLine -like \"*$needle*\" } |",
    "ForEach-Object { Invoke-CimMethod -InputObject $_ -MethodName Terminate | Out-Null }",
  ].join(" ");

  await new Promise((resolve) => {
    const killer = spawn("powershell.exe", ["-NoProfile", "-Command", command], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("exit", resolve);
    killer.once("error", resolve);
  });
  await sleep(1000);
}
