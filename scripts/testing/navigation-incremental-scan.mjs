import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const sources = await Promise.all(
  [
    "../../extension/scripts/navigation/shared.js",
    "../../extension/scripts/navigation/page-digest.js",
    "../../extension/scripts/navigation/candidate-scan/links.js",
    "../../extension/scripts/navigation/candidate-scan.js",
  ].map((filePath) => readFile(new URL(filePath, import.meta.url), "utf8"))
);

let bodyTextReads = 0;
let intersectionCallback = null;
let observedAnchorCount = 0;
const anchors = Array.from({ length: 140 }, (_, index) =>
  makeAnchor(`https://target.example/page-${index}`, index)
);
const documentElement = makeTraversalRoot(anchors);
const pendingRegistrations = [];
const appliedRules = [];
let synchronizedPolicies = 0;

const sandbox = {
  URL,
  console,
  location: {
    href: "https://source.example/first",
  },
  document: {
    title: "Incremental navigation fixture",
    readyState: "complete",
    prerendering: false,
    activeElement: null,
    documentElement,
    body: {},
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
  IntersectionObserver: class {
    constructor(callback) {
      intersectionCallback = callback;
    }

    observe() {
      observedAnchorCount += 1;
    }

    unobserve() {}

    disconnect() {}
  },
};
Object.defineProperty(sandbox.document.body, "innerText", {
  get() {
    bodyTextReads += 1;
    return "One body text snapshot should serve the whole scan cycle.";
  },
});
sandbox.globalThis = sandbox;

const context = vm.createContext(sandbox);
vm.runInContext(sources[0], context, { filename: "navigation/shared.js" });
Object.assign(context.ZeroLatencyNavigationContent, {
  normalizeShortText(value) {
    return String(value || "").trim().slice(0, 240);
  },
  normalizeLongText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  },
  normalizeNavigableHref(value) {
    try {
      return new URL(String(value || ""), context.location.href).href;
    } catch (_error) {
      return null;
    }
  },
  getAnchorNavigationTarget() {
    return "_self";
  },
  resolveManagedNavigationTarget(_sourceUrl, targetUrl) {
    return targetUrl ? "_self" : null;
  },
  isGoogleSearchInternalModeNavigation() {
    return false;
  },
  collectAnchorPreloadSafety() {
    return {};
  },
  inspectAnchorSideEffectPreloadSafety() {
    return {
      skipPreload: false,
      preloadSafety: {},
    };
  },
  shouldSkipSensitivePagePreload() {
    return false;
  },
  reportPageDigestToBackground() {
    return Promise.resolve();
  },
  isPassivePrerenderContext() {
    return false;
  },
});
vm.runInContext(sources[1], context, { filename: "navigation/page-digest.js" });
vm.runInContext(sources[2], context, { filename: "navigation/candidate-scan/links.js" });
Object.assign(context.ZeroLatencyNavigationContent, {
  hasActiveEditableFocus() {
    return false;
  },
  filterWaterfallDynamicLinks(links) {
    return links;
  },
  registerPreloadCandidates(payload) {
    return new Promise((resolve) => {
      pendingRegistrations.push({ payload, resolve });
    });
  },
  syncContentScriptPreloadPolicy() {
    synchronizedPolicies += 1;
  },
  applySpeculationRules(rules) {
    appliedRules.push(rules);
  },
});
vm.runInContext(sources[3], context, { filename: "navigation/candidate-scan.js" });

const navigation = context.ZeroLatencyNavigationContent;
navigation.initializeCandidateAnchorIndex(documentElement);

let batchCount = 0;
let batchResult;
do {
  batchResult = navigation.processCandidateMutationWorkBatch();
  batchCount += 1;
  assert.ok(
    batchResult.visitedNodes <= navigation.constants.CANDIDATE_MUTATION_NODE_BATCH_SIZE
  );
  assert.ok(
    batchResult.processedAnchors <= navigation.constants.CANDIDATE_DIRTY_ANCHOR_BATCH_SIZE
  );
} while (batchResult.hasPendingWork);

assert.ok(batchCount > 1, "large discovery must be split across bounded batches");
assert.equal(
  anchors.reduce((total, anchor) => total + anchor.rectReads, 0),
  anchors.length,
  "each initially discovered anchor should be measured once"
);
assert.equal(observedAnchorCount, anchors.length);
intersectionCallback([
  {
    target: anchors[0],
    isIntersecting: true,
    boundingClientRect: {
      top: 500,
      bottom: 520,
      left: 10,
      right: 210,
      width: 200,
      height: 20,
    },
  },
]);
assert.equal(
  anchors[0].rectReads,
  1,
  "IntersectionObserver updates must reuse the supplied visibility geometry"
);
assert.equal(navigation.collectCandidateLinks().length, navigation.constants.MAX_CANDIDATE_LINKS);

const oldAnchorRectReads = anchors.reduce((total, anchor) => total + anchor.rectReads, 0);
const addedAnchor = makeAnchor("https://target.example/added", 200);
navigation.enqueueCandidateMutations([
  {
    type: "childList",
    target: documentElement,
    addedNodes: [addedAnchor],
    removedNodes: [],
  },
]);
const incrementalBatch = navigation.processCandidateMutationWorkBatch();
assert.ok(
  incrementalBatch.visitedNodes <= navigation.constants.CANDIDATE_MUTATION_NODE_BATCH_SIZE
);
assert.ok(
  incrementalBatch.processedAnchors <= navigation.constants.CANDIDATE_DIRTY_ANCHOR_BATCH_SIZE
);
assert.equal(addedAnchor.rectReads, 1, "the changed anchor should be indexed");
assert.equal(
  anchors.reduce((total, anchor) => total + anchor.rectReads, 0),
  oldAnchorRectReads,
  "an incremental mutation must not remeasure unchanged anchors"
);

const firstSnapshot = navigation.collectPageContentSnapshot();
assert.equal(navigation.collectPageTextDigest(), firstSnapshot.textDigest);
assert.equal(navigation.buildPageContentFingerprint(), firstSnapshot.contentFingerprint);
assert.equal(bodyTextReads, 1, "digest and fingerprint must share one body text read");

const staleToken = navigation.capturePageGenerationToken();
const staleRequest = navigation.sendCandidateLinks({
  force: true,
  pageSnapshot: firstSnapshot,
  pageToken: staleToken,
});
await waitFor(() => pendingRegistrations.length === 1);
assert.equal(pendingRegistrations[0].payload.pageUrl, "https://source.example/first");

context.location.href = "https://source.example/second";
assert.equal(navigation.advancePageGeneration(context.location.href), true);
pendingRegistrations.shift().resolve({
  contentScriptPolicy: {},
  prerenderTargets: [{ url: "https://target.example/stale" }],
  prefetchTargets: [],
});
await staleRequest;

assert.equal(appliedRules.length, 0, "a stale SPA response must not apply speculation rules");
assert.equal(synchronizedPolicies, 0, "a stale SPA response must not update page policy");
assert.equal(navigation.state.lastSentCandidateSignature, null);
assert.equal(navigation.state.lastCandidateRegistrationGeneration, 0);

const currentSnapshot = navigation.collectPageContentSnapshot();
const currentToken = navigation.capturePageGenerationToken();
const currentRequest = navigation.sendCandidateLinks({
  force: true,
  pageSnapshot: currentSnapshot,
  pageToken: currentToken,
});
await waitFor(() => pendingRegistrations.length === 1);
pendingRegistrations.shift().resolve({
  contentScriptPolicy: {},
  prerenderTargets: [{ url: "https://target.example/current" }],
  prefetchTargets: [],
});
await currentRequest;

assert.equal(appliedRules.length, 1, "the current page response should still apply");
assert.equal(synchronizedPolicies, 1);
assert.equal(
  navigation.state.lastCandidateRegistrationGeneration,
  navigation.state.pageGeneration
);
assert.equal(navigation.state.lastCandidateRegistrationUrl, context.location.href);

console.log(
  JSON.stringify(
    {
      ok: true,
      batchCount,
      checked: [
        "incremental discovery is bounded by node and anchor batch limits",
        "IntersectionObserver visibility updates reuse cached geometry",
        "mutations do not remeasure unchanged anchors",
        "page digest and fingerprint reuse one body text snapshot",
        "stale SPA candidate responses cannot apply speculation rules",
      ],
    },
    null,
    2
  )
);

function makeAnchor(href, index) {
  const text = `Candidate ${index}`;

  return {
    nodeType: 1,
    tagName: "A",
    isConnected: true,
    href,
    target: "",
    rel: "",
    innerText: text,
    textContent: text,
    parentElement: {
      innerText: text,
    },
    firstElementChild: null,
    nextElementSibling: null,
    rectReads: 0,
    closest() {
      return null;
    },
    querySelector() {
      return null;
    },
    getAttribute(name) {
      return name === "href" ? href : null;
    },
    hasAttribute() {
      return false;
    },
    getBoundingClientRect() {
      this.rectReads += 1;
      const top = 10 + (index % 20);
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

function makeTraversalRoot(children) {
  const root = {
    nodeType: 1,
    tagName: "HTML",
    clientWidth: 1280,
    clientHeight: 800,
    firstElementChild: children[0] || null,
    nextElementSibling: null,
    closest() {
      return null;
    },
  };

  for (let index = 0; index < children.length; index += 1) {
    children[index].nextElementSibling = children[index + 1] || null;
  }

  return root;
}

async function waitFor(predicate) {
  const deadline = Date.now() + 1000;

  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for asynchronous navigation test state.");
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
