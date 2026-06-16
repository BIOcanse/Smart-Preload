import { cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export const DEFAULT_EXTENSION_FIXTURE_ENTRIES = [
  "manifest.json",
  "service-worker.js",
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
}) {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });

  for (const entry of entries) {
    const source = path.join(extensionDir, entry);
    const target = path.join(targetDir, entry);
    if (!existsSync(source)) {
      continue;
    }
    await cp(source, target, {
      recursive: true,
      force: true,
    });
  }
}
