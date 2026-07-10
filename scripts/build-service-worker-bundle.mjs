import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const options = parseArguments(process.argv.slice(2));
const extensionRoot = path.resolve(options.extensionRoot);
const manifestPath = path.join(extensionRoot, "service-worker-scripts.js");
const entryPath = path.join(extensionRoot, "service-worker.js");
const bundlePath = path.join(extensionRoot, "service-worker-runtime.js");
const manifestContext = vm.createContext({ globalThis: {} });
vm.runInContext(await readFile(manifestPath, "utf8"), manifestContext, {
  filename: manifestPath,
});
const scriptPaths = manifestContext.globalThis.ZERO_LATENCY_SERVICE_WORKER_SCRIPTS;

if (!Array.isArray(scriptPaths) || scriptPaths.length === 0) {
  throw new Error("The service-worker script manifest is empty or invalid.");
}

const sections = [];

for (const relativePath of scriptPaths) {
  const absolutePath = path.resolve(extensionRoot, relativePath);

  if (!absolutePath.startsWith(`${extensionRoot}${path.sep}`)) {
    throw new Error(`Service-worker source escapes extension root: ${relativePath}`);
  }

  const source = await readFile(absolutePath, "utf8");
  sections.push(`\n// Source: ${relativePath}\n${source.trimEnd()}\n`);
}

const bundle = sections.join("\n");
new vm.Script(bundle, { filename: bundlePath });
await writeFile(bundlePath, bundle, "utf8");

const entrySource = await readFile(entryPath, "utf8");
const nextEntrySource = entrySource.replace(
  /^\uFEFF?importScripts\("service-worker-scripts\.js"\);\r?\nimportScripts\(\.\.\.globalThis\.ZERO_LATENCY_SERVICE_WORKER_SCRIPTS\);\r?\n/u,
  'importScripts("service-worker-runtime.js");\n'
);

if (nextEntrySource === entrySource) {
  throw new Error("The service-worker entry imports did not match the expected source form.");
}

await writeFile(entryPath, nextEntrySource, "utf8");
console.log(
  JSON.stringify({
    ok: true,
    scriptCount: scriptPaths.length,
    bundlePath,
    bundleBytes: Buffer.byteLength(bundle),
  })
);

function parseArguments(args) {
  const extensionRootIndex = args.indexOf("--extension-root");
  const extensionRoot =
    extensionRootIndex >= 0 ? args[extensionRootIndex + 1] : "extension";

  if (!extensionRoot) {
    throw new Error("--extension-root requires a path.");
  }

  return { extensionRoot };
}
