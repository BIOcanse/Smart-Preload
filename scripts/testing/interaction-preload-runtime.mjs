import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPaths = [
  ["extansion", "background", "shared", "base.js"],
  ["extansion", "background", "preload", "state", "model.js"],
  ["extansion", "background", "preload", "state", "normalize", "entries.js"],
  ["extansion", "background", "preload", "state", "normalize", "runtime.js"],
  ["extansion", "background", "preload", "state", "lookup", "normal-windows.js"],
  ["extansion", "background", "preload", "state", "lookup", "source-tabs.js"],
  ["extansion", "background", "preload", "state", "lookup", "pruning.js"],
  ["extansion", "background", "preload", "incognito-policy.js"],
  ["extansion", "background", "preload", "runtime", "source-tabs", "hidden-tabs.js"],
  ["extansion", "background", "preload", "runtime", "source-tabs", "speculation.js"],
  ["extansion", "background", "preload", "runtime", "interaction.js"],
].map((segments) => path.join(repoRoot, ...segments));

const context = {
  console,
  Date,
  Number,
  URL,
  setTimeout,
};
context.globalThis = context;
context.ZeroLatencyDebugEvents = {
  events: [],
  record(name, payload) {
    this.events.push({ name, payload });
  },
};
context.currentSettings = { preloading: { enabled: true, excludeIncognitoWindows: true } };
context.getEffectiveExtensionSettings = () => context.currentSettings;
context.getPreloadResourcePressureState = async () => ({ shouldDeferHiddenTabs: false });
context.reassignSourceTabRuntimeIfNeeded = async (preloadState) => preloadState;
context.closeTabIfExists = async (tabId) => {
  context.closedTabIds.push(tabId);
};
context.getTabMaybe = async () => null;
context.getWindowMaybe = async () => ({ type: "normal" });
context.primePreloadEntry = async (_windowId, entry) => {
  entry.tabId = 9001;
  entry.loadedUrl = entry.requestedUrl;
  entry.status = "complete";
};
context.isExtensionServicePaused = async () => false;
context.isPreloadTab = () => false;
context.isExcludedGooglePage = () => false;
context.isTrackableAndAllowedUrl = (rawUrl) => /^https?:\/\//i.test(String(rawUrl || ""));
context.normalizeNavigableUrl = (rawUrl, baseUrl) => {
  try {
    return new URL(rawUrl, baseUrl).href;
  } catch {
    return "";
  }
};
context.buildNodeSeed = (rawUrl) => {
  const parsedUrl = new URL(rawUrl);
  return {
    nodeId: parsedUrl.origin,
    pageUrl: parsedUrl.href,
  };
};
context.isSameOriginUrl = (leftUrl, rightUrl) => new URL(leftUrl).origin === new URL(rightUrl).origin;
context.determinePreloadStrategy = () => "prerender";
context.supportsHiddenTabPreloadStrategy = () => true;
context.ZeroLatencyPreloadWindowManager = {
  async ensureWindow(preloadState, normalWindowId) {
    const runtime = context.ensureNormalWindowRuntime(preloadState, normalWindowId);
    runtime.preloadWindow.windowId = 99;
    return { windowId: 99, created: true };
  },
  async maintainHiddenState() {},
};
context.closedTabIds = [];
context.savedPreloadState = null;
context.loadPreloadState = async () => context.savedPreloadState;
context.savePreloadState = async (preloadState) => {
  context.savedPreloadState = preloadState;
};

vm.createContext(context);

for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

const interactionMetadata = {
  trigger: "hover",
  targetHint: "_self",
  startedAt: "2026-06-02T00:00:00.000Z",
  updatedAt: "2026-06-02T00:00:00.000Z",
};
const preloadState = {
  normalWindowsById: {
    1: {
      normalWindowId: 1,
      preloadWindow: context.createEmptyPreloadWindowState(),
      sourceTabs: {
        2: {
          sourceTabId: 2,
          hiddenTabEntriesByUrl: {
            "https://interaction.example/hidden": {
              tabId: 101,
              requestedUrl: "https://interaction.example/hidden",
              loadedUrl: "https://interaction.example/hidden",
              nodeId: "https://interaction.example",
              score: 0,
              status: "complete",
              interactionPreload: interactionMetadata,
            },
            "https://regular.example/hidden": {
              tabId: 102,
              requestedUrl: "https://regular.example/hidden",
              loadedUrl: "https://regular.example/hidden",
              nodeId: "https://regular.example",
              score: 5,
              status: "complete",
            },
          },
          prerenderEntriesByUrl: {
            "https://interaction.example/prerender": {
              requestedUrl: "https://interaction.example/prerender",
              nodeId: "https://interaction.example",
              score: 0,
              status: "prerender",
              strategy: "prerender",
              targetHint: "_self",
              interactionPreload: interactionMetadata,
            },
            "https://regular.example/prerender": {
              requestedUrl: "https://regular.example/prerender",
              nodeId: "https://regular.example",
              score: 5,
              status: "prerender",
              strategy: "prerender",
              targetHint: "_self",
            },
          },
          prefetchEntriesByUrl: {
            "https://interaction.example/prefetch": {
              requestedUrl: "https://interaction.example/prefetch",
              nodeId: "https://interaction.example",
              score: 0,
              status: "prefetch",
              strategy: "prefetch",
              interactionPreload: interactionMetadata,
            },
            "https://regular.example/prefetch": {
              requestedUrl: "https://regular.example/prefetch",
              nodeId: "https://regular.example",
              score: 5,
              status: "prefetch",
              strategy: "prefetch",
            },
          },
          updatedAt: null,
        },
      },
      updatedAt: null,
    },
  },
  updatedAt: null,
};

await context.synchronizePreloadsForSourceTab(preloadState, 1, 2, []);
assert.ok(
  preloadState.normalWindowsById[1].sourceTabs[2].hiddenTabEntriesByUrl[
    "https://interaction.example/hidden"
  ]
);
assert.ok(
  !preloadState.normalWindowsById[1].sourceTabs[2].hiddenTabEntriesByUrl[
    "https://regular.example/hidden"
  ]
);
assert.deepEqual(context.closedTabIds, [102]);

context.synchronizePrerenderEntriesForSourceTab(preloadState, 1, 2, []);
context.synchronizePrefetchEntriesForSourceTab(preloadState, 1, 2, []);
assert.ok(
  preloadState.normalWindowsById[1].sourceTabs[2].prerenderEntriesByUrl[
    "https://interaction.example/prerender"
  ]
);
assert.ok(
  !preloadState.normalWindowsById[1].sourceTabs[2].prerenderEntriesByUrl[
    "https://regular.example/prerender"
  ]
);
assert.ok(
  preloadState.normalWindowsById[1].sourceTabs[2].prefetchEntriesByUrl[
    "https://interaction.example/prefetch"
  ]
);
assert.ok(
  !preloadState.normalWindowsById[1].sourceTabs[2].prefetchEntriesByUrl[
    "https://regular.example/prefetch"
  ]
);

let response;
context.savedPreloadState = context.createEmptyPreloadState();
response = await context.ZeroLatencyPreloadInteraction.startInteractionPreload(
  {
    sourcePageUrl: "https://private.example/page",
    targetUrl: "/same-origin-new-tab",
    trigger: "contextmenu",
    forceNewTab: true,
  },
  {
    tab: {
      id: 303,
      windowId: 404,
      url: "https://private.example/page",
      incognito: true,
    },
  }
);
assert.equal(response.skipped, true);
assert.equal(response.reason, "incognito-excluded");
assert.equal(Object.keys(context.savedPreloadState.normalWindowsById).length, 0);

{
  context.savedPreloadState = context.createEmptyPreloadState();
  const runtimeEntry = context.ensureSourceTabRuntime(context.savedPreloadState, 404, 303);
  runtimeEntry.sourceTabRuntime.hiddenTabEntriesByUrl["https://private.example/old"] = {
    tabId: 606,
    requestedUrl: "https://private.example/old",
    loadedUrl: "https://private.example/old",
    nodeId: "https://private.example",
    score: 0,
    status: "complete",
  };
  context.savedPreloadState.scheduler = {
    ...context.createEmptyPreloadSchedulerState(),
    candidateSelectionSnapshotsByTabId: {
      303: {
        sourceTabId: 303,
        sourceWindowId: 404,
        sourcePageUrl: "https://private.example/page",
        currentNodeId: "https://private.example",
        scoreSignals: {
          native: { scoreSum: 1, candidateCount: 1, linkValueMultiplier: 1 },
          tab: { scoreSum: 1, candidateCount: 1, linkValueMultiplier: 1 },
        },
        candidateLinks: [],
        selectedTargets: [],
      },
    },
    attentionPendingByKey: {
      "303\nhttps://private.example/page": {
        tabId: 303,
        windowId: 404,
        pageUrl: "https://private.example/page",
        durationMs: 10_000,
      },
    },
  };
  const cleanup = await context.ZeroLatencyPreloadIncognitoPolicy.clearExcludedIncognitoPreloadState(
    context.savedPreloadState,
    context.currentSettings,
    {
      tabs: [{ id: 303, windowId: 404, incognito: true }],
      reason: "unit-test",
    }
  );
  assert.equal(cleanup.mutated, true);
  assert.ok(context.closedTabIds.includes(606));
  assert.equal(context.savedPreloadState.normalWindowsById[404], undefined);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(context.savedPreloadState.scheduler.candidateSelectionSnapshotsByTabId)
    ),
    {}
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.savedPreloadState.scheduler.attentionPendingByKey)),
    {}
  );
}

context.currentSettings = { preloading: { enabled: true, excludeIncognitoWindows: false } };
context.savedPreloadState = context.createEmptyPreloadState();
response = await context.ZeroLatencyPreloadInteraction.startInteractionPreload(
  {
    sourcePageUrl: "https://private.example/page",
    targetUrl: "/same-origin-new-tab",
    trigger: "contextmenu",
    forceNewTab: true,
  },
  {
    tab: {
      id: 303,
      windowId: 404,
      url: "https://private.example/page",
      incognito: true,
    },
  }
);
assert.equal(response.strategy, "hidden-tab");
assert.ok(
  context.savedPreloadState.normalWindowsById[404].sourceTabs[303].hiddenTabEntriesByUrl[
    "https://private.example/same-origin-new-tab"
  ]
);

context.currentSettings = { preloading: { enabled: true, excludeIncognitoWindows: true } };
context.savedPreloadState = context.createEmptyPreloadState();
response = await context.ZeroLatencyPreloadInteraction.startInteractionPreload(
  {
    sourcePageUrl: "https://source.example/page",
    targetUrl: "/same-origin-new-tab",
    trigger: "contextmenu",
    forceNewTab: true,
  },
  {
    tab: {
      id: 3,
      windowId: 4,
      url: "https://source.example/page",
    },
  }
);
assert.equal(response.strategy, "hidden-tab");
assert.ok(
  context.savedPreloadState.normalWindowsById[4].sourceTabs[3].hiddenTabEntriesByUrl[
    "https://source.example/same-origin-new-tab"
  ]
);
assert.equal(
  context.ZeroLatencyPreloadInteraction.hasContextMenuInteractionHiddenTabPreload(
    context.savedPreloadState,
    {
      sourceTab: { id: 3, windowId: 4 },
      targetUrl: "https://source.example/same-origin-new-tab",
    }
  ),
  true
);
context.savedPreloadState.normalWindowsById[4].sourceTabs[3].hiddenTabEntriesByUrl[
  "https://source.example/same-origin-new-tab"
].interactionPreload.trigger = "hover";
assert.equal(
  context.ZeroLatencyPreloadInteraction.hasContextMenuInteractionHiddenTabPreload(
    context.savedPreloadState,
    {
      sourceTab: { id: 3, windowId: 4 },
      targetUrl: "https://source.example/same-origin-new-tab",
    }
  ),
  false
);

context.savedPreloadState = context.createEmptyPreloadState();
context.supportsHiddenTabPreloadStrategy = () => false;
response = await context.ZeroLatencyPreloadInteraction.startInteractionPreload(
  {
    sourcePageUrl: "https://source.example/page",
    targetUrl: "/same-origin-new-tab",
    trigger: "contextmenu",
    forceNewTab: true,
  },
  {
    tab: {
      id: 3,
      windowId: 4,
      url: "https://source.example/page",
    },
  }
);
assert.equal(response.strategy, "prefetch");
assert.equal(response.prefetchTargets.length, 1);
assert.equal(response.prefetchTargets[0].url, "https://source.example/same-origin-new-tab");

context.savedPreloadState = context.createEmptyPreloadState();
{
  const runtimeEntry = context.ensureSourceTabRuntime(context.savedPreloadState, 4, 3);
  runtimeEntry.sourceTabRuntime.hiddenTabEntriesByUrl[
    "https://source.example/incognito-release"
  ] = {
    tabId: 77,
    requestedUrl: "https://source.example/incognito-release",
    loadedUrl: "https://source.example/incognito-release",
    nodeId: "https://source.example",
    score: 0,
    status: "complete",
    interactionPreload: {
      trigger: "contextmenu",
      targetHint: "_blank",
      startedAt: "2026-06-02T00:00:00.000Z",
      updatedAt: "2026-06-02T00:00:00.000Z",
    },
  };
}
const discardResult =
  await context.ZeroLatencyPreloadInteraction.discardContextMenuInteractionHiddenTabPreload({
    sourceTab: { id: 3, windowId: 4 },
    targetUrl: "https://source.example/incognito-release",
    reason: "incognito-target",
  });
assert.equal(discardResult.removed, true);
assert.equal(discardResult.tabId, 77);
assert.ok(context.closedTabIds.includes(77));
assert.equal(
  context.savedPreloadState.normalWindowsById[4]?.sourceTabs?.[3]?.hiddenTabEntriesByUrl?.[
    "https://source.example/incognito-release"
  ],
  undefined
);

console.log("interaction preload runtime tests passed");
