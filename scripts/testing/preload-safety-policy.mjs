import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const safetyRuleSources = await Promise.all(
  [
    "../../extansion/shared/preload-safety-rules/constants.js",
    "../../extansion/shared/preload-safety-rules/url.js",
    "../../extansion/shared/preload-safety-rules/decision.js",
    "../../extansion/shared/preload-safety-rules/candidate.js",
    "../../extansion/shared/preload-safety-rules.js",
  ].map((filePath) => readFile(new URL(filePath, import.meta.url), "utf8"))
);
const policySources = await Promise.all(
  [
    "../../extansion/background/preload/safety-policy/normalize.js",
    "../../extansion/background/preload/safety-policy/dangerous-site.js",
    "../../extansion/background/preload/safety-policy/decision.js",
    "../../extansion/background/preload/safety-policy.js",
  ].map((filePath) => readFile(new URL(filePath, import.meta.url), "utf8"))
);
const context = vm.createContext({ URL, globalThis: {} });
for (const [index, source] of safetyRuleSources.entries()) {
  vm.runInContext(source, context, {
    filename: `preload-safety-rules-${index}.js`,
  });
}
for (const [index, source] of policySources.entries()) {
  vm.runInContext(source, context, {
    filename: `safety-policy-${index}.js`,
  });
}

const policy = context.globalThis.ZeroLatencyPreloadSafetyPolicy;

assert.equal(typeof policy.inspectPreloadCandidate, "function");

assertUnsafe("https://example.com/download/tool.exe", "download-file-extension");
assertUnsafe("https://example.com/files?download=1", "download-query");
assertUnsafe("https://example.com/account/logout", "side-effect-url-path");
assertUnsafe("https://example.com/export/report", "download-url-path");

const downloadAttributeDecision = policy.inspectPreloadCandidate({
  url: "https://example.com/plain-page",
  preloadSafety: {
    downloadAttribute: true,
  },
});
assert.equal(downloadAttributeDecision.enabled, true);
assert.equal(downloadAttributeDecision.locked, true);
assert.equal(downloadAttributeDecision.skipPreload, true);
assert.equal(downloadAttributeDecision.realPreloadBlocked, true);
assert.equal(downloadAttributeDecision.sideEffectBlocked, true);
assert.equal(downloadAttributeDecision.dangerousSiteBlocked, false);
assert.ok(downloadAttributeDecision.reasons.includes("download-attribute"));
assert.ok(downloadAttributeDecision.sideEffectReasons.includes("download-attribute"));

const safeDecision = policy.inspectPreloadCandidate({
  url: "https://example.com/docs/page",
});
assert.equal(safeDecision.enabled, true);
assert.equal(safeDecision.locked, true);
assert.equal(safeDecision.skipPreload, false);
assert.equal(safeDecision.realPreloadBlocked, false);
assert.equal(safeDecision.sideEffectBlocked, false);
assert.equal(safeDecision.dangerousSiteBlocked, false);
assert.equal(safeDecision.reasons.length, 0);

const invalidDecision = policy.inspectPreloadCandidate({
  url: "file:///C:/Users/kings/Downloads/test.html",
});
assert.equal(invalidDecision.skipPreload, true);
assert.equal(invalidDecision.realPreloadBlocked, true);
assert.equal(invalidDecision.reason, "invalid-url");
assert.equal(invalidDecision.sideEffectBlocked, true);
assert.equal(invalidDecision.dangerousSiteBlocked, false);

const dangerousSiteDecision = policy.inspectPreloadCandidate({
  url: "https://example.com/login",
  preloadSafety: {
    dangerousSite: true,
    threatSource: "test-threat-list",
    threatTypes: ["MALWARE", "SOCIAL_ENGINEERING"],
  },
});
assert.equal(dangerousSiteDecision.skipPreload, true);
assert.equal(dangerousSiteDecision.realPreloadBlocked, true);
assert.equal(dangerousSiteDecision.sideEffectBlocked, false);
assert.equal(dangerousSiteDecision.dangerousSiteBlocked, true);
assert.ok(dangerousSiteDecision.reasons.includes("dangerous-site-verdict"));
assert.ok(dangerousSiteDecision.dangerousSiteReasons.includes("dangerous-site-malware"));
assert.equal(dangerousSiteDecision.dangerousSiteEvidence.verdict, "unsafe");
assert.equal(dangerousSiteDecision.dangerousSiteEvidence.reason, "");
assert.equal(dangerousSiteDecision.dangerousSiteEvidence.source, "test-threat-list");
assert.deepEqual(
  Array.from(dangerousSiteDecision.dangerousSiteEvidence.threatTypes),
  ["MALWARE", "SOCIAL_ENGINEERING"]
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "download extension",
        "download query",
        "side-effect path",
        "download path",
        "download attribute",
        "safe link",
        "invalid URL",
        "dangerous site verdict",
      ],
    },
    null,
    2
  )
);

function assertUnsafe(url, expectedReason) {
  const decision = policy.inspectPreloadCandidate({ url });

  assert.equal(decision.enabled, true);
  assert.equal(decision.locked, true);
  assert.equal(decision.skipPreload, true);
  assert.equal(decision.realPreloadBlocked, true);
  assert.equal(decision.sideEffectBlocked, true);
  assert.ok(
    decision.reasons.includes(expectedReason),
    `${url} should include ${expectedReason}; got ${decision.reasons.join(", ")}`
  );
}
