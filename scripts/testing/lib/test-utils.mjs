import net from "node:net";
import { rm } from "node:fs/promises";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchJson(url, init = {}) {
  const { timeoutMs = 10000, ...fetchInit } = init || {};
  const response = await fetch(url, {
    ...fetchInit,
    signal: fetchInit.signal ?? AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

export async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

export async function rmWithRetry(targetPath, attempts = 8, baseDelayMs = 250) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await rm(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await sleep(baseDelayMs * attempt);
    }
  }

  throw lastError;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function stripHash(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    return url.href;
  } catch (_error) {
    return String(rawUrl || "");
  }
}

export function sameUrl(actual, expected) {
  return stripHash(actual) === stripHash(expected);
}

export function getEventName(event) {
  return String(event?.eventName || event?.event || event?.name || event?.type || "");
}

export function createHostResolverRules(hosts) {
  return [...new Set(hosts)]
    .map((host) => `MAP ${host} 127.0.0.1`)
    .join(", ");
}
