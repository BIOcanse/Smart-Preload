import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const sharedPlaywrightBrowsersPath = path.join(
  "D:\\",
  "Code",
  "CommonAssets",
  "Tools",
  "Playwright",
  "ms-playwright"
);

const userPlaywrightBrowsersPath = path.join(
  process.env.LocalAppData || "",
  "ms-playwright"
);

export function findFirstExistingExecutable(candidates) {
  return candidates.find((candidate) => candidate && existsSync(candidate)) || null;
}

export function getSharedPlaywrightChromiumPathCandidates() {
  return collectChromiumExecutables(sharedPlaywrightBrowsersPath);
}

export function getUserPlaywrightChromiumPathCandidates() {
  return collectChromiumExecutables(userPlaywrightBrowsersPath);
}

export function getPlaywrightChromiumPathCandidates() {
  return uniquePaths(
    [
      ...collectChromiumExecutables(process.env.ZLW_PLAYWRIGHT_BROWSERS_PATH),
      ...collectChromiumExecutables(process.env.PLAYWRIGHT_BROWSERS_PATH),
      ...getSharedPlaywrightChromiumPathCandidates(),
      ...getUserPlaywrightChromiumPathCandidates(),
    ].filter(Boolean)
  );
}

export function getChromePathCandidates() {
  return uniquePaths([
    ...getPlaywrightChromiumPathCandidates(),
    path.join(
      process.env.ProgramFiles || "C:\\Program Files",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe"
    ),
    path.join(
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe"
    ),
    path.join(
      process.env.LocalAppData || "",
      "Google",
      "Chrome",
      "Application",
      "chrome.exe"
    ),
  ]);
}

export function getEdgePathCandidates() {
  return uniquePaths([
    path.join(
      process.env.ProgramFiles || "C:\\Program Files",
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe"
    ),
    path.join(
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe"
    ),
    path.join(
      process.env.LocalAppData || "",
      "Microsoft",
      "Edge",
      "Application",
      "msedge.exe"
    ),
  ]);
}

function collectChromiumExecutables(browserRoot) {
  if (!browserRoot || !existsSync(browserRoot)) {
    return [];
  }

  return readdirSync(browserRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => chromiumBuildNumber(right) - chromiumBuildNumber(left))
    .flatMap((directoryName) => [
      path.join(browserRoot, directoryName, "chrome-win64", "chrome.exe"),
      path.join(browserRoot, directoryName, "chrome-win", "chrome.exe"),
    ]);
}

function chromiumBuildNumber(directoryName) {
  return Number(directoryName.match(/\d+$/)?.[0] || 0);
}

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean))];
}
