import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const threatDatabaseSources = await Promise.all(
  [
    "../../extansion/background/security/threat-database/fingerprint.js",
    "../../extansion/background/security/threat-database/sources.js",
    "../../extansion/background/security/threat-database.js",
  ].map((filePath) => readFile(new URL(filePath, import.meta.url), "utf8"))
);
const safetyRuleSources = await Promise.all(
  [
    "../../extansion/shared/preload-safety-rules/constants.js",
    "../../extansion/shared/preload-safety-rules/url.js",
    "../../extansion/shared/preload-safety-rules/decision.js",
    "../../extansion/shared/preload-safety-rules/candidate.js",
    "../../extansion/shared/preload-safety-rules.js",
    "../../extansion/shared/sensitive-site-rules/constants.js",
    "../../extansion/shared/sensitive-site-rules/url.js",
    "../../extansion/shared/sensitive-site-rules/match.js",
    "../../extansion/shared/sensitive-site-rules.js",
  ].map((filePath) => readFile(new URL(filePath, import.meta.url), "utf8"))
);
const safetyPolicySources = await Promise.all(
  [
    "../../extansion/background/preload/sensitive-site-policy.js",
    "../../extansion/background/preload/safety-policy/normalize.js",
    "../../extansion/background/preload/safety-policy/dangerous-site.js",
    "../../extansion/background/preload/safety-policy/sensitive-site.js",
    "../../extansion/background/preload/safety-policy/decision.js",
    "../../extansion/background/preload/safety-policy.js",
  ].map((filePath) => readFile(new URL(filePath, import.meta.url), "utf8"))
);
const candidatePoolMergeSource = await readFile(
  new URL(
    "../../extansion/background/preload/prediction/candidate-pool/merge.js",
    import.meta.url
  ),
  "utf8"
);
const candidatePoolLinkSource = await readFile(
  new URL(
    "../../extansion/background/preload/prediction/candidate-pool/link.js",
    import.meta.url
  ),
  "utf8"
);
const candidatePoolSource = await readFile(
  new URL("../../extansion/background/preload/prediction/candidate-pool.js", import.meta.url),
  "utf8"
);
const context = vm.createContext({ URL, BigInt, globalThis: {} });

for (const [index, source] of threatDatabaseSources.entries()) {
  vm.runInContext(source, context, {
    filename: `threat-database-${index}.js`,
  });
}

const blockedUrl = "https://malware.example/landing/payload";
const normalizedUrl =
  context.globalThis.ZeroLatencyLocalThreatDatabase.normalizeThreatUrl(blockedUrl);
const fingerprint =
  context.globalThis.ZeroLatencyLocalThreatDatabase.fingerprintThreatUrl(normalizedUrl);
const hostFingerprint =
  context.globalThis.ZeroLatencyLocalThreatDatabase.fingerprintThreatHost("malware.example");

context.globalThis.ZeroLatencyLocalThreatLibrary = {
  version: 1,
  generatedAt: "2026-06-16T00:00:00.000Z",
  totalUrlFingerprints: 1,
  urlFingerprintAlgorithm: "fnv1a64-url-v1",
  normalization: "http-url-no-fragment-v1",
  sources: [
    {
      id: "test-source",
      name: "Test source",
      threatTypes: ["malware"],
      fingerprintCount: 1,
    },
  ],
  urlFingerprintsBySource: {
    "test-source": [fingerprint],
  },
  hostFingerprintsBySource: {
    "test-source": [hostFingerprint],
  },
};

assert.equal(
  context.globalThis.ZeroLatencyLocalThreatDatabase.inspectUrl(blockedUrl).blocked,
  true
);
assert.equal(
  context.globalThis.ZeroLatencyLocalThreatDatabase.inspectUrl("https://safe.example/").blocked,
  false
);
const subdomainDecision = context.globalThis.ZeroLatencyLocalThreatDatabase.inspectUrl(
  "https://cdn.malware.example/other/path"
);
assert.equal(subdomainDecision.blocked, true);
assert.equal(subdomainDecision.evidence.matchScope, "host-subtree");

for (const [index, source] of safetyRuleSources.entries()) {
  vm.runInContext(source, context, {
    filename: `preload-safety-rules-${index}.js`,
  });
}
for (const [index, source] of safetyPolicySources.entries()) {
  vm.runInContext(source, context, {
    filename: `safety-policy-${index}.js`,
  });
}

const decision = context.globalThis.ZeroLatencyPreloadSafetyPolicy.inspectPreloadCandidate({
  url: blockedUrl,
});
assert.equal(decision.skipPreload, true);
assert.equal(decision.realPreloadBlocked, true);
assert.equal(decision.sideEffectBlocked, false);
assert.equal(decision.dangerousSiteBlocked, true);
assert.ok(decision.reasons.includes("dangerous-site-local-threat-library"));
assert.ok(decision.reasons.includes("dangerous-site-malware"));
assert.equal(decision.dangerousSiteEvidence.source, "test-source");
assert.equal(decision.dangerousSiteEvidence.matchScope, "exact-url");

const subdomainSafetyDecision =
  context.globalThis.ZeroLatencyPreloadSafetyPolicy.inspectPreloadCandidate({
    url: "https://cdn.malware.example/other/path",
  });
assert.equal(subdomainSafetyDecision.skipPreload, true);
assert.equal(subdomainSafetyDecision.dangerousSiteBlocked, true);
assert.ok(subdomainSafetyDecision.reasons.includes("dangerous-site-local-host-subtree"));
assert.equal(subdomainSafetyDecision.dangerousSiteEvidence.matchScope, "host-subtree");

context.normalizeNavigableUrl = (rawUrl, baseUrl) => {
  try {
    const url = new URL(rawUrl, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch (_error) {
    return null;
  }
};
context.isExcludedTrackingPage = () => false;
context.globalThis.ZeroLatencyDebugEvents = {
  records: [],
  record(name, payload) {
    this.records.push({ name, payload });
  },
};
context.globalThis.ZeroLatencyPreloadProxySkipPolicy = {
  shouldSkipProxyPreloadCandidate() {
    return false;
  },
};
context.buildNodeSeed = (rawUrl) => ({ nodeId: new URL(rawUrl).origin });
context.normalizePageUrlForIndex = (rawUrl) => rawUrl;
context.isSameOriginUrl = (leftUrl, rightUrl) => new URL(leftUrl).origin === new URL(rightUrl).origin;
context.getRecordedLinkTargetHint = () => null;

vm.runInContext(candidatePoolMergeSource, context, {
  filename: "candidate-pool/merge.js",
});
vm.runInContext(candidatePoolLinkSource, context, {
  filename: "candidate-pool/link.js",
});
vm.runInContext(candidatePoolSource, context, {
  filename: "candidate-pool.js",
});

const sourceUrl = "https://source.example/page";
const candidatePoolByUrl = context.buildLinkCandidatePoolByUrl({
  sourceNodeId: "https://source.example",
  sourceUrl,
  graph: {},
  settings: {},
  sourcePageUrl: sourceUrl,
  sourceCandidateLinks: [
    { url: "https://cdn.malware.example/other/path", anchorText: "blocked" },
    { url: "https://safe.example/page", anchorText: "safe" },
  ],
  transitionWindowKey: "total",
});
assert.equal(candidatePoolByUrl.has("https://cdn.malware.example/other/path"), false);
assert.equal(candidatePoolByUrl.has("https://safe.example/page"), true);
assert.ok(
  context.globalThis.ZeroLatencyDebugEvents.records.some(
    (entry) =>
      entry.name === "preload.safety.skip-candidate" &&
      entry.payload?.targetUrl === "https://cdn.malware.example/other/path"
  )
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "local threat database exact lookup",
        "local threat database host subtree lookup",
        "safety policy local exact verdict",
        "safety policy local host subtree verdict",
        "candidate pool early safety filtering",
      ],
    },
    null,
    2
  )
);
