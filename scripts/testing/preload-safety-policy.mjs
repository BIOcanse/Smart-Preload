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
    "../../extansion/shared/sensitive-site-rules/constants.js",
    "../../extansion/shared/sensitive-site-rules/url.js",
    "../../extansion/shared/sensitive-site-rules/match.js",
    "../../extansion/shared/sensitive-site-rules.js",
  ].map((filePath) => readFile(new URL(filePath, import.meta.url), "utf8"))
);
const policySources = await Promise.all(
  [
    "../../extansion/background/preload/sensitive-site-policy.js",
    "../../extansion/background/preload/safety-policy/normalize.js",
    "../../extansion/background/preload/safety-policy/dangerous-site.js",
    "../../extansion/background/preload/safety-policy/sensitive-site.js",
    "../../extansion/background/preload/safety-policy/decision.js",
    "../../extansion/background/preload/safety-policy.js",
  ].map((filePath) => readFile(new URL(filePath, import.meta.url), "utf8"))
);
const context = vm.createContext({
  URL,
  globalThis: {},
  isPlainObject(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  },
  createEmptyPreloadState() {
    return {};
  },
});
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
assert.equal(dangerousSiteDecision.sensitiveSiteBlocked, false);
assert.ok(dangerousSiteDecision.reasons.includes("dangerous-site-verdict"));
assert.ok(dangerousSiteDecision.dangerousSiteReasons.includes("dangerous-site-malware"));
assert.equal(dangerousSiteDecision.dangerousSiteEvidence.verdict, "unsafe");
assert.equal(dangerousSiteDecision.dangerousSiteEvidence.reason, "");
assert.equal(dangerousSiteDecision.dangerousSiteEvidence.source, "test-threat-list");
assert.deepEqual(
  Array.from(dangerousSiteDecision.dangerousSiteEvidence.threatTypes),
  ["MALWARE", "SOCIAL_ENGINEERING"]
);

const bankingDecision = policy.inspectPreloadCandidate({
  url: "https://www.bankofamerica.com/accounts",
});
assert.equal(bankingDecision.skipPreload, true);
assert.equal(bankingDecision.realPreloadBlocked, true);
assert.equal(bankingDecision.sideEffectBlocked, false);
assert.equal(bankingDecision.dangerousSiteBlocked, false);
assert.equal(bankingDecision.sensitiveSiteBlocked, true);
assert.ok(bankingDecision.reasons.includes("sensitive-site-banking"));
assert.ok(bankingDecision.sensitiveSiteReasons.includes("sensitive-site-banking"));
assert.equal(bankingDecision.sensitiveSiteEvidence.matches[0].category, "banking");

const examDecision = policy.inspectPreloadCandidate({
  url: "https://school.example/courses/intro/quizzes/final",
});
assert.equal(examDecision.skipPreload, true);
assert.equal(examDecision.sensitiveSiteBlocked, true);
assert.ok(examDecision.reasons.includes("sensitive-site-exam"));

const sensitiveDisabledDecision = policy.inspectPreloadCandidate(
  {
    url: "https://www.bankofamerica.com/accounts",
  },
  "",
  {
    preloading: {
      skipSensitivePages: false,
    },
  }
);
assert.equal(sensitiveDisabledDecision.skipPreload, false);
assert.equal(sensitiveDisabledDecision.sensitiveSiteBlocked, false);

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
        "sensitive banking site",
        "sensitive exam path",
        "sensitive guard disabled",
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
