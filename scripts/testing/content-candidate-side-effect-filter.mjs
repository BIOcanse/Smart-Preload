import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const sharedSource = await readFile(
  new URL("../../extension/scripts/navigation/shared.js", import.meta.url),
  "utf8"
);
const sharedTextSource = await readFile(
  new URL("../../extension/scripts/navigation/shared/text.js", import.meta.url),
  "utf8"
);
const sharedUrlSource = await readFile(
  new URL("../../extension/scripts/navigation/shared/url.js", import.meta.url),
  "utf8"
);
const sharedFocusSource = await readFile(
  new URL("../../extension/scripts/navigation/shared/focus.js", import.meta.url),
  "utf8"
);
const sharedSafetySource = await readFile(
  new URL("../../extension/scripts/navigation/shared/safety.js", import.meta.url),
  "utf8"
);
const safetyRuleSources = await Promise.all(
  [
    "../../extension/shared/preload-safety-rules/constants.js",
    "../../extension/shared/preload-safety-rules/url.js",
    "../../extension/shared/preload-safety-rules/decision.js",
    "../../extension/shared/preload-safety-rules/candidate.js",
    "../../extension/shared/preload-safety-rules.js",
    "../../extension/shared/sensitive-site-rules/constants.js",
    "../../extension/shared/sensitive-site-rules/url.js",
    "../../extension/shared/sensitive-site-rules/match.js",
    "../../extension/shared/sensitive-site-rules.js",
  ].map((filePath) => readFile(new URL(filePath, import.meta.url), "utf8"))
);
const candidateScanSource = await readFile(
  new URL("../../extension/scripts/navigation/candidate-scan.js", import.meta.url),
  "utf8"
);
const candidateScanLinksSource = await readFile(
  new URL("../../extension/scripts/navigation/candidate-scan/links.js", import.meta.url),
  "utf8"
);

const anchors = [
  makeAnchor("https://example.com/docs/page", {
    text: "Safe page",
    top: 20,
  }),
  makeAnchor("https://example.com/download/tool.exe", {
    text: "Download binary",
    top: 40,
  }),
  makeAnchor("https://example.com/account/logout", {
    text: "Log out",
    top: 60,
  }),
  makeAnchor("https://example.com/report", {
    attributes: {
      download: "report.csv",
    },
    text: "Download report",
    top: 80,
  }),
  makeAnchor("https://example.com/file", {
    attributes: {
      type: "application/octet-stream",
    },
    text: "Binary file",
    top: 100,
  }),
  makeAnchor("https://example.com/files?download=1", {
    text: "Download query",
    top: 120,
  }),
  makeAnchor("https://www.bankofamerica.com/accounts", {
    text: "Online banking",
    top: 140,
  }),
  makeAnchor("https://school.example/courses/intro/quizzes/final", {
    text: "Final quiz",
    top: 160,
  }),
];

const sandbox = {
  URL,
  console,
  location: {
    href: "https://source.example/start",
  },
  document: {
    title: "Candidate scan fixture",
    readyState: "complete",
    prerendering: false,
    activeElement: null,
    documentElement: {
      clientWidth: 1280,
      clientHeight: 800,
    },
    querySelectorAll(selector) {
      return selector === "a[href]" ? anchors : [];
    },
  },
  window: {
    innerWidth: 1280,
    innerHeight: 800,
    setTimeout,
    clearTimeout,
    getComputedStyle() {
      return {
        display: "inline",
        visibility: "visible",
      };
    },
  },
};
sandbox.globalThis = sandbox;

const context = vm.createContext(sandbox);
for (const [index, source] of safetyRuleSources.entries()) {
  vm.runInContext(source, context, {
    filename: `preload-safety-rules-${index}.js`,
  });
}
vm.runInContext(sharedSource, context, {
  filename: "shared.js",
});
vm.runInContext(sharedTextSource, context, {
  filename: "shared/text.js",
});
vm.runInContext(sharedUrlSource, context, {
  filename: "shared/url.js",
});
vm.runInContext(sharedFocusSource, context, {
  filename: "shared/focus.js",
});
vm.runInContext(sharedSafetySource, context, {
  filename: "shared/safety.js",
});
vm.runInContext(candidateScanLinksSource, context, {
  filename: "candidate-scan/links.js",
});
vm.runInContext(candidateScanSource, context, {
  filename: "candidate-scan.js",
});

const navigationContent = context.ZeroLatencyNavigationContent;
assert.equal(typeof navigationContent.inspectAnchorSideEffectPreloadSafety, "function");
assert.equal(typeof navigationContent.collectCandidateLinks, "function");

const safeDecision = navigationContent.inspectAnchorSideEffectPreloadSafety(
  makeAnchor("https://example.com/docs/page"),
  "https://example.com/docs/page"
);
assert.equal(safeDecision.skipPreload, false);

const downloadDecision = navigationContent.inspectAnchorSideEffectPreloadSafety(
  makeAnchor("https://example.com/report", {
    attributes: {
      download: "report.csv",
    },
  }),
  "https://example.com/report"
);
assert.equal(downloadDecision.skipPreload, true);
assert.ok(downloadDecision.reasons.includes("download-attribute"));

const sensitiveDecision = navigationContent.inspectAnchorSideEffectPreloadSafety(
  makeAnchor("https://www.bankofamerica.com/accounts", {
    text: "Online banking",
  }),
  "https://www.bankofamerica.com/accounts"
);
assert.equal(sensitiveDecision.skipPreload, true);
assert.equal(sensitiveDecision.sideEffectBlocked, false);
assert.equal(sensitiveDecision.sensitiveSiteBlocked, true);
assert.ok(sensitiveDecision.reasons.includes("sensitive-site-banking"));

const candidateLinks = navigationContent.collectCandidateLinks();
assert.equal(
  Array.from(candidateLinks, (link) => String(link.url)).join("\n"),
  "https://example.com/docs/page"
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "content candidate scan keeps safe links",
        "content candidate scan drops download extension links",
        "content candidate scan drops side-effect path links",
        "content candidate scan drops download attribute links",
        "content candidate scan drops unsafe MIME links",
        "content candidate scan drops download query links",
        "content candidate scan drops sensitive banking links",
        "content candidate scan drops sensitive exam links",
      ],
    },
    null,
    2
  )
);

function makeAnchor(href, options = {}) {
  const attributes = new Map(Object.entries(options.attributes || {}));
  const text = String(options.text || "");
  const top = Number.isFinite(Number(options.top)) ? Number(options.top) : 10;

  return {
    href,
    target: options.target || "",
    rel: attributes.get("rel") || "",
    innerText: text,
    textContent: text,
    parentElement: {
      innerText: text,
    },
    closest() {
      return null;
    },
    querySelector() {
      return null;
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
    getBoundingClientRect() {
      return {
        top,
        bottom: top + 20,
        left: 10,
        right: 210,
        width: 200,
        height: 20,
      };
    },
  };
}
