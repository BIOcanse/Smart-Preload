import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const sharedSource = await readFile(
  new URL("../../extansion/scripts/navigation/shared.js", import.meta.url),
  "utf8"
);
const candidateScanSource = await readFile(
  new URL("../../extansion/scripts/navigation/candidate-scan.js", import.meta.url),
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
vm.runInContext(sharedSource, context, {
  filename: "shared.js",
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
