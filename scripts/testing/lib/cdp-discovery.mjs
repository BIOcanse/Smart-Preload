import { CdpClient, runtimeEval } from "./cdp-client.mjs";
import { fetchJson, sleep } from "./test-utils.mjs";

export async function waitForTarget(debugPort, predicate, timeoutMs = 15000) {
  const startedAt = Date.now();
  let lastTargets = [];

  while (Date.now() - startedAt < timeoutMs) {
    let targets = [];
    try {
      targets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
      lastTargets = targets;
    } catch (_error) {
      await sleep(250);
      continue;
    }

    const target = targets.find(predicate);
    if (target?.webSocketDebuggerUrl) {
      return target;
    }
    await sleep(250);
  }

  throw new Error(
    `Timed out waiting for CDP target. Last targets: ${JSON.stringify(
      lastTargets.map((target) => ({
        type: target.type,
        url: target.url,
        title: target.title,
      })),
      null,
      2
    )}`
  );
}

export async function waitForExtensionServiceWorker({
  debugPort,
  isTargetManifest,
  timeoutMs = 20000,
  failureLabel = "Zero-Latency Web service worker",
}) {
  const startedAt = Date.now();
  let lastTargets = [];
  const inspectedManifests = [];
  const inspectionErrors = [];

  while (Date.now() - startedAt < timeoutMs) {
    let targets = [];
    try {
      targets = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
      lastTargets = targets;
    } catch (_error) {
      await sleep(250);
      continue;
    }

    for (const target of targets) {
      if (
        target.type !== "service_worker" ||
        !/^chrome-extension:\/\//.test(target.url || "") ||
        !target.webSocketDebuggerUrl
      ) {
        continue;
      }

      let client = null;

      try {
        client = await CdpClient.connect(target.webSocketDebuggerUrl);
        await client.send("Runtime.enable");
        const manifest = await runtimeEval(client, "chrome.runtime.getManifest()");
        const permissions = Array.isArray(manifest?.permissions)
          ? manifest.permissions
          : [];
        const manifestInfo = {
          url: target.url,
          name: manifest?.name || null,
          permissions,
        };
        inspectedManifests.push(manifestInfo);

        if (isTargetManifest({ manifest, permissions, target })) {
          return {
            ...target,
            manifest,
            client,
          };
        }
      } catch (error) {
        inspectionErrors.push({
          url: target.url,
          error: error?.message || String(error),
        });
      }

      client?.close();
    }

    await sleep(250);
  }

  throw new Error(
    `Timed out waiting for ${failureLabel}. Last targets: ${JSON.stringify(
      lastTargets.map((target) => ({
        type: target.type,
        url: target.url,
        title: target.title,
      })),
      null,
      2
    )}; inspected manifests: ${JSON.stringify(
      inspectedManifests.slice(-8),
      null,
      2
    )}; inspection errors: ${JSON.stringify(inspectionErrors.slice(-8), null, 2)}`
  );
}
