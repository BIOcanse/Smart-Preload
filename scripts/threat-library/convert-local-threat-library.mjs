import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..", "..");
const sourcePath = path.join(
  repositoryRoot,
  "extension",
  "background",
  "security",
  "local-threat-library.js"
);
const outputPath = path.join(
  repositoryRoot,
  "extension",
  "background",
  "security",
  "local-threat-library.json"
);
const context = vm.createContext({ globalThis: {} });

vm.runInContext(await readFile(sourcePath, "utf8"), context, { filename: sourcePath });

if (!context.globalThis.ZeroLatencyLocalThreatLibrary) {
  throw new Error("The source threat library did not define its expected payload.");
}

await writeFile(
  outputPath,
  `${JSON.stringify(context.globalThis.ZeroLatencyLocalThreatLibrary)}\n`,
  "utf8"
);
console.log(outputPath);
