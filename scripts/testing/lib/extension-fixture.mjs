import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const DEFAULT_EXTENSION_FIXTURE_ENTRIES = [
  "manifest.json",
  "service-worker.js",
  "service-worker-scripts.js",
  "_locales",
  "images",
  "background",
  "popup",
  "scripts",
  "settings",
  "shared",
  path.join("wasm", "pkg"),
];

export async function prepareExtensionUnderTest({
  extensionDir,
  targetDir,
  entries = DEFAULT_EXTENSION_FIXTURE_ENTRIES,
  preferPackaged = true,
}) {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });

  const sourceRoot =
    preferPackaged === true
      ? (await findPackagedExtensionStage(extensionDir)) ?? extensionDir
      : extensionDir;

  for (const entry of entries) {
    const source = path.join(sourceRoot, entry);
    const target = path.join(targetDir, entry);
    if (!existsSync(source)) {
      continue;
    }
    await cp(source, target, {
      recursive: true,
      force: true,
    });
  }

  return {
    sourceRoot,
    usedPackaged: sourceRoot !== extensionDir,
  };
}

export async function findPackagedExtensionStage(extensionDir) {
  const repoRoot = path.dirname(extensionDir);
  const version = await readManifestVersion(extensionDir);

  if (!version) {
    return null;
  }

  const stage = path.join(
    repoRoot,
    "dist",
    "staging",
    `release-v${version}`,
    `zero-latency-web-extension-v${version}`
  );
  const manifestPath = path.join(stage, "manifest.json");

  return existsSync(manifestPath) ? stage : null;
}

async function readManifestVersion(extensionDir) {
  try {
    const manifest = JSON.parse(
      await readFile(path.join(extensionDir, "manifest.json"), "utf8")
    );
    return String(manifest?.version || "").trim();
  } catch (_error) {
    return "";
  }
}
