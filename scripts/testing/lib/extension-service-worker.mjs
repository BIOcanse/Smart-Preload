import { waitForExtensionServiceWorker as waitForExtensionServiceWorkerTarget } from "./cdp-discovery.mjs";

export async function waitForZeroLatencyExtensionServiceWorker({
  debugPort,
  timeoutMs = 20000,
  requiredPermissions = [],
  failureLabel = "Zero-Latency Web service worker",
} = {}) {
  return waitForExtensionServiceWorkerTarget({
    debugPort,
    timeoutMs,
    failureLabel,
    isTargetManifest: ({ manifest, permissions }) =>
      isZeroLatencyExtensionManifest(manifest) &&
      requiredPermissions.every((permission) => permissions.includes(permission)),
  });
}

export function isZeroLatencyExtensionManifest(manifest) {
  return (
    manifest?.background?.service_worker === "service-worker.js" &&
    manifest?.options_page === "settings/index.html"
  );
}
