import assert from "node:assert/strict";
import { buildInteractionPreloadRuntimeState } from "./lib/interaction-preload-runtime-fixtures.mjs";
import { loadInteractionPreloadRuntimeVmContext } from "./lib/interaction-preload-runtime-vm.mjs";

const context = loadInteractionPreloadRuntimeVmContext();

const interactionMetadata = {
  trigger: "hover",
  targetHint: "_self",
  startedAt: "2026-06-02T00:00:00.000Z",
  updatedAt: "2026-06-02T00:00:00.000Z",
};
const preloadState = buildInteractionPreloadRuntimeState(context, interactionMetadata);

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
assert.ok(
  preloadState.normalWindowsById[1].sourceTabs[2].hiddenTabEntriesByUrl[
    "https://bookmark.example/hidden"
  ]
);
assert.deepEqual(context.closedTabIds, [102]);

await context.ZeroLatencyBookmarkPreloadDiff.syncTargets(preloadState, 1, 2, []);
assert.ok(
  !preloadState.normalWindowsById[1].sourceTabs[2].hiddenTabEntriesByUrl[
    "https://bookmark.example/hidden"
  ]
);
assert.deepEqual(context.closedTabIds, [102, 103]);

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
context.currentSettings = {
  preloading: {
    enabled: true,
    interactionPreloadEnabled: false,
    excludeIncognitoWindows: true,
  },
};
context.savedPreloadState = context.createEmptyPreloadState();
response = await context.ZeroLatencyPreloadInteraction.getInteractionPreloadStatus(
  {
    sourcePageUrl: "https://disabled.example/page",
    targetUrl: "/target",
    targetHint: "_self",
  },
  {
    tab: {
      id: 203,
      windowId: 204,
      url: "https://disabled.example/page",
    },
  }
);
assert.equal(response.ok, false);
assert.equal(response.preloaded, false);
assert.equal(response.reason, "interaction-preload-disabled");
response = await context.ZeroLatencyPreloadInteraction.startInteractionPreload(
  {
    sourcePageUrl: "https://disabled.example/page",
    targetUrl: "/target",
    trigger: "hover",
  },
  {
    tab: {
      id: 203,
      windowId: 204,
      url: "https://disabled.example/page",
    },
  }
);
assert.equal(response.skipped, true);
assert.equal(response.reason, "interaction-preload-disabled");
assert.equal(Object.keys(context.savedPreloadState.normalWindowsById).length, 0);

context.currentSettings = {
  preloading: {
    enabled: true,
    interactionPreloadEnabled: true,
    excludeIncognitoWindows: true,
  },
};
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

context.currentSettings = {
  preloading: {
    enabled: true,
    interactionPreloadEnabled: true,
    excludeIncognitoWindows: false,
  },
};
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

context.currentSettings = {
  preloading: {
    enabled: true,
    interactionPreloadEnabled: true,
    excludeIncognitoWindows: true,
  },
};
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
