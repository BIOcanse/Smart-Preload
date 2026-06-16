import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const defaultOutputPath = path.join(
  repoRoot,
  "extansion",
  "background",
  "security",
  "local-threat-library.js"
);
const userAgent =
  "SmartPreloadThreatSnapshot/1.0 (+https://github.com/BIOcanse/Smart-Preload)";
const sourceDefinitions = {
  urlhaus: {
    id: "urlhaus",
    name: "URLhaus",
    homepageUrl: "https://urlhaus.abuse.ch/",
    feedUrl: "https://urlhaus.abuse.ch/downloads/text/",
    licenseUrl: "https://urlhaus.abuse.ch/api/",
    threatTypes: ["malware"],
    parse: parseUrlhausText,
  },
  phishtank: {
    id: "phishtank",
    name: "PhishTank",
    homepageUrl: "https://www.phishtank.net/",
    feedUrl: "http://data.phishtank.com/data/online-valid.json",
    licenseUrl: "https://www.phishtank.net/developer_info.php",
    threatTypes: ["phishing"],
    parse: parsePhishtankJson,
  },
};

const options = parseArgs(process.argv.slice(2));
const selectedSourceIds = options.sources.length > 0 ? options.sources : ["urlhaus"];
const sourceResults = [];

for (const sourceId of selectedSourceIds) {
  const definition = sourceDefinitions[sourceId];

  if (!definition) {
    throw new Error(`Unknown threat source: ${sourceId}`);
  }

  sourceResults.push(await fetchSource(definition, options));
}

const generatedSource = renderThreatLibrary(sourceResults);
await mkdir(path.dirname(options.outputPath), { recursive: true });
await writeFile(options.outputPath, generatedSource, "utf8");

console.log(
  JSON.stringify(
    {
      ok: true,
      outputPath: options.outputPath,
      sources: sourceResults.map((source) => ({
        id: source.id,
        rawUrlCount: source.rawUrlCount,
        fingerprintCount: source.fingerprints.length,
        hostFingerprintCount: source.hostFingerprints.length,
      })),
      totalUrlFingerprints: sourceResults.reduce(
        (total, source) => total + source.fingerprints.length,
        0
      ),
      totalHostFingerprints: sourceResults.reduce(
        (total, source) => total + source.hostFingerprints.length,
        0
      ),
    },
    null,
    2
  )
);

async function fetchSource(definition, options) {
  const fetchedAt = new Date().toISOString();
  const text = await fetchText(definition.feedUrl, options.timeoutMs);
  const urls = definition.parse(text);
  const fingerprints = [];
  const hostFingerprints = [];
  const seenFingerprints = new Set();
  const seenHostFingerprints = new Set();

  for (const rawUrl of urls) {
    const normalizedUrl = normalizeThreatUrl(rawUrl);

    if (!normalizedUrl) {
      continue;
    }

    const fingerprint = fingerprintThreatUrl(normalizedUrl);

    if (seenFingerprints.has(fingerprint)) {
      continue;
    }

    seenFingerprints.add(fingerprint);
    fingerprints.push(fingerprint);

    const normalizedHostname = normalizeThreatHostname(new URL(normalizedUrl).hostname);
    const hostFingerprint = normalizedHostname
      ? fingerprintThreatHost(normalizedHostname)
      : "";

    if (hostFingerprint && !seenHostFingerprints.has(hostFingerprint)) {
      seenHostFingerprints.add(hostFingerprint);
      hostFingerprints.push(hostFingerprint);
    }

    if (options.maxPerSource > 0 && fingerprints.length >= options.maxPerSource) {
      break;
    }
  }

  fingerprints.sort();
  hostFingerprints.sort();

  return {
    ...definition,
    fetchedAt,
    rawUrlCount: urls.length,
    fingerprints,
    hostFingerprints,
  };
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": userAgent,
        Accept: "text/plain, application/json, text/csv;q=0.8, */*;q=0.5",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseUrlhausText(text) {
  return String(text || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function parsePhishtankJson(text) {
  const value = JSON.parse(text);

  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => String(entry?.url || "").trim()).filter(Boolean);
}

function renderThreatLibrary(sourceResults) {
  const generatedAt = new Date().toISOString();
  const sources = sourceResults.map((source) => ({
    id: source.id,
    name: source.name,
    fetchedAt: source.fetchedAt,
    homepageUrl: source.homepageUrl,
    feedUrl: source.feedUrl,
    licenseUrl: source.licenseUrl,
    threatTypes: source.threatTypes,
    rawUrlCount: source.rawUrlCount,
    fingerprintCount: source.fingerprints.length,
    hostFingerprintCount: source.hostFingerprints.length,
  }));
  const fingerprintsBySource = Object.fromEntries(
    sourceResults.map((source) => [source.id, source.fingerprints])
  );
  const hostFingerprintsBySource = Object.fromEntries(
    sourceResults.map((source) => [source.id, source.hostFingerprints])
  );
  const totalUrlFingerprints = sourceResults.reduce(
    (total, source) => total + source.fingerprints.length,
    0
  );
  const totalHostFingerprints = sourceResults.reduce(
    (total, source) => total + source.hostFingerprints.length,
    0
  );

  return `(function () {
  globalThis.ZeroLatencyLocalThreatLibrary = {
    version: 1,
    generatedAt: ${JSON.stringify(generatedAt)},
    totalUrlFingerprints: ${totalUrlFingerprints},
    totalHostFingerprints: ${totalHostFingerprints},
    urlFingerprintAlgorithm: "fnv1a64-url-v1",
    hostFingerprintAlgorithm: "fnv1a64-host-v1",
    normalization: "http-url-no-fragment-and-host-subtree-v2",
    sources: ${JSON.stringify(sources, null, 6).replace(/^/gmu, "    ").trimStart()},
    urlFingerprintsBySource: ${renderFingerprintMap(fingerprintsBySource)},
    hostFingerprintsBySource: ${renderFingerprintMap(hostFingerprintsBySource)},
  };
})();
`;
}

function renderFingerprintMap(fingerprintsBySource) {
  const lines = ["{"];
  const entries = Object.entries(fingerprintsBySource);

  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const [sourceId, fingerprints] = entries[entryIndex];
    const sourceSuffix = entryIndex === entries.length - 1 ? "" : ",";
    lines.push(`      ${JSON.stringify(sourceId)}: [`);

    for (let index = 0; index < fingerprints.length; index += 8) {
      const chunk = fingerprints.slice(index, index + 8);
      const suffix = index + 8 >= fingerprints.length ? "" : ",";
      lines.push(`        ${chunk.map((item) => JSON.stringify(item)).join(", ")}${suffix}`);
    }

    lines.push(`      ]${sourceSuffix}`);
  }

  lines.push("    }");
  return lines.join("\n");
}

function normalizeThreatUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "";
    }

    url.hash = "";
    return url.href;
  } catch (_error) {
    return "";
  }
}

function fingerprintThreatUrl(normalizedUrl) {
  return fingerprintString(String(normalizedUrl || ""));
}

function normalizeThreatHostname(rawHostname) {
  return String(rawHostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[/u, "")
    .replace(/\]$/u, "");
}

function fingerprintThreatHost(normalizedHostname) {
  return fingerprintString(normalizeThreatHostname(normalizedHostname));
}

function fingerprintString(value) {
  const normalizedValue = String(value || "");
  let hash = 0xcbf29ce484222325n;

  for (let index = 0; index < normalizedValue.length; index += 1) {
    hash ^= BigInt(normalizedValue.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }

  return `${hash.toString(16).padStart(16, "0")}:${normalizedValue.length}`;
}

function parseArgs(args) {
  const options = {
    sources: [],
    maxPerSource: 0,
    timeoutMs: 60_000,
    outputPath: defaultOutputPath,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [rawKey, inlineValue] = arg.split("=", 2);
    const key = rawKey.replace(/^--/u, "");
    const value = inlineValue ?? args[index + 1];

    if (inlineValue == null && arg.startsWith("--")) {
      index += 1;
    }

    if (key === "source" || key === "sources") {
      options.sources = String(value || "")
        .split(",")
        .map((source) => source.trim())
        .filter(Boolean);
    } else if (key === "max-per-source") {
      options.maxPerSource = Math.max(0, Number.parseInt(value, 10) || 0);
    } else if (key === "timeout-ms") {
      options.timeoutMs = Math.max(5_000, Number.parseInt(value, 10) || options.timeoutMs);
    } else if (key === "output") {
      options.outputPath = path.resolve(repoRoot, value);
    }
  }

  return options;
}
