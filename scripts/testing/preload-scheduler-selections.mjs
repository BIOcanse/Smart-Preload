import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPaths = [
  ["extansion", "shared", "settings.js"],
  ["extansion", "background", "shared", "base.js"],
  ["extansion", "background", "tracking", "url", "model.js"],
  ["extansion", "background", "preload", "state", "model.js"],
  ["extansion", "background", "preload", "state", "normalize", "entries.js"],
  ["extansion", "background", "preload", "state", "normalize", "runtime.js"],
  ["extansion", "background", "preload", "proxy-skip-policy.js"],
  ["extansion", "background", "preload", "native-only-policy.js"],
  ["extansion", "background", "preload", "scoring.js"],
  ["extansion", "background", "preload", "prediction", "strategy", "flags.js"],
  ["extansion", "background", "preload", "prediction", "strategy", "scenario.js"],
  ["extansion", "background", "preload", "prediction", "strategy", "same-origin.js"],
  ["extansion", "background", "preload", "prediction", "strategy", "cross-site-current-tab.js"],
  ["extansion", "background", "preload", "prediction", "strategy", "cross-site-new-tab.js"],
  ["extansion", "background", "preload", "prediction", "strategy-router.js"],
  ["extansion", "background", "preload", "scheduler", "allocation.js"],
  ["extansion", "background", "preload", "scheduler", "attention.js"],
  ["extansion", "background", "preload", "scheduler", "selections.js"],
].map((segments) => path.join(repoRoot, ...segments));

const context = {
  console,
  Math,
  Number,
  Date,
  URL,
  navigator: {
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgent: "node-test",
  },
  BOOKMARK_PRELOAD_BUCKET_STARTUP_GOOGLE_SEARCH: "startupGoogleSearch",
  BOOKMARK_PRELOAD_BUCKET_NEW_GOOGLE_SEARCH_TAB: "newGoogleSearchTab",
};
context.globalThis = context;
context.ZeroLatencySupport = {
  supportsHiddenTabPreloadRuntime: () => true,
};
vm.createContext(context);

for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

context.settingsApi = context.ZeroLatencySettings;

const {
  applyPreloadSchedulerCandidateSelection,
  schedulePreloadCandidateSelectionSnapshots,
  rescheduleStoredPreloadSelections,
  buildSchedulerDiscoverySlotLimits,
} = context.ZeroLatencyPreloadSchedulerSelections;
const settings = context.ZeroLatencySettings.resolveEffectiveSettings({
  ...context.ZeroLatencySettings.DEFAULT_SETTINGS,
  preloading: {
    ...context.ZeroLatencySettings.DEFAULT_SETTINGS.preloading,
    realPreloadEnabled: true,
    scheduler: {
      ...context.ZeroLatencySettings.DEFAULT_SETTINGS.preloading.scheduler,
      nativeTotalMin: 4,
      nativeTotalMax: 4,
      tabTotalMin: 5,
      tabTotalMax: 5,
    },
  },
});
const bookmarkEnabledSettings = context.ZeroLatencySettings.cloneSettings(settings);
bookmarkEnabledSettings.layout.ruleCards.items.googleBookmarkRank.status = "enabled";
bookmarkEnabledSettings.layout.ruleCards.items.googleBookmarkRank.valueA = 1;
bookmarkEnabledSettings.layout.ruleCards.items.googleBookmarkRank.operatorA = "lte";
bookmarkEnabledSettings.layout.ruleCards.items.googleBookmarkRank.operatorB = "lte";
bookmarkEnabledSettings.layout.ruleCards.items.googleBookmarkRank.valueC = 5;
const currentTabSwapSettings = context.ZeroLatencySettings.resolveEffectiveSettings({
  ...context.ZeroLatencySettings.DEFAULT_SETTINGS,
  experiments: {
    ...context.ZeroLatencySettings.DEFAULT_SETTINGS.experiments,
    crossSiteCurrentTabSwap: true,
  },
  preloading: {
    ...context.ZeroLatencySettings.DEFAULT_SETTINGS.preloading,
    realPreloadEnabled: true,
    scheduler: {
      ...context.ZeroLatencySettings.DEFAULT_SETTINGS.preloading.scheduler,
      nativeTotalMin: 4,
      nativeTotalMax: 4,
      tabTotalMin: 5,
      tabTotalMax: 5,
    },
  },
});
const browserNativeOnlySettings = context.ZeroLatencySettings.resolveEffectiveSettings({
  ...context.ZeroLatencySettings.DEFAULT_SETTINGS,
  preloading: {
    ...context.ZeroLatencySettings.DEFAULT_SETTINGS.preloading,
    realPreloadEnabled: false,
    scheduler: {
      ...context.ZeroLatencySettings.DEFAULT_SETTINGS.preloading.scheduler,
      nativeTotalMin: 4,
      nativeTotalMax: 4,
      tabTotalMin: 5,
      tabTotalMax: 5,
    },
  },
  experiments: {
    ...context.ZeroLatencySettings.DEFAULT_SETTINGS.experiments,
    crossSiteCurrentTabSwap: true,
  },
});

assert.deepEqual(
  JSON.parse(JSON.stringify(context.ZeroLatencySettings.FULLSCREEN_PRESSURE_POLICY_VALUES)),
  ["close", "sleep", "ignore"]
);
assert.equal(
  context.ZeroLatencySettings.normalizeStoredSettings({
    preloadWindow: { fullscreenPressurePolicy: "close" },
  }).preloadWindow.fullscreenPressurePolicy,
  "close"
);
assert.equal(
  context.ZeroLatencySettings.normalizeStoredSettings({
    preloadWindow: { fullscreenPressurePolicy: "invalid" },
  }).preloadWindow.fullscreenPressurePolicy,
  "sleep"
);
assert.equal(
  context.ZeroLatencySettings.normalizeStoredSettings({}).preloading.excludeIncognitoWindows,
  true
);
assert.equal(
  context.ZeroLatencySettings.normalizeStoredSettings({
    preloading: { excludeIncognitoWindows: false },
  }).preloading.excludeIncognitoWindows,
  false
);
assert.equal(
  context.ZeroLatencySettings.normalizeStoredSettings({}).preloading.interactionPreloadEnabled,
  true
);
assert.equal(
  context.ZeroLatencySettings.normalizeStoredSettings({
    preloading: { interactionPreloadEnabled: false },
  }).preloading.interactionPreloadEnabled,
  false
);
assert.equal(
  context.ZeroLatencySettings.normalizeStoredSettings({}).experiments.crossSiteCurrentTabSwap,
  false
);
assert.equal(
  context.ZeroLatencySettings.normalizeStoredSettings({
    experiments: { crossSiteCurrentTabSwap: true },
  }).experiments.crossSiteCurrentTabSwap,
  false
);
assert.equal(
  context.ZeroLatencySettings.normalizeStoredSettings({
    preloading: { realPreloadEnabled: true },
    experiments: { crossSiteCurrentTabSwap: true },
  }).experiments.crossSiteCurrentTabSwap,
  true
);
assert.equal(
  context.ZeroLatencySettings.normalizeStoredSettings({
    preloading: { realPreloadEnabled: false },
    experiments: { crossSiteCurrentTabSwap: true },
  }).experiments.crossSiteCurrentTabSwap,
  false
);

assert.deepEqual(JSON.parse(JSON.stringify(buildSchedulerDiscoverySlotLimits(settings))), {
  nativePageSlotLimit: 4,
  tabPageSlotLimit: 5,
});

const mixedCandidateLinks = [
  {
    isSameOrigin: true,
    targetHint: "_self",
    score: 2,
  },
  {
    isSameOrigin: false,
    targetHint: "_self",
    outboundPageTransitionCount: 3,
    score: 5,
  },
  {
    isSameOrigin: false,
    targetHint: "_blank",
    outboundPageTransitionCount: 0,
    score: 7,
  },
  {
    isSameOrigin: false,
    targetHint: "_blank",
    outboundPageTransitionCount: 99,
    score: 999,
    bookmarkPreload: {
      bucketKey: "startupGoogleSearch",
      count: 10,
      rank: 1,
      title: "Bookmark target",
    },
  },
];

assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      context.buildPreloadSchedulerScoreSignals(mixedCandidateLinks, settings)
    )
  ),
  {
    native: {
      scoreSum: buildExpectedSchedulerScoreSum([2, 5, 7]),
      candidateCount: 3,
      linkValueMultiplier: context.buildSchedulerLinkValueMultiplier(
        buildExpectedSchedulerScoreSum([2, 5, 7])
      ),
    },
    tab: {
      scoreSum: 0,
      candidateCount: 0,
      linkValueMultiplier: 1,
    },
  }
);

assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      context.buildPreloadSchedulerScoreSignals(mixedCandidateLinks, currentTabSwapSettings)
    )
  ),
  {
    native: {
      scoreSum: buildExpectedSchedulerScoreSum([2, 7]),
      candidateCount: 2,
      linkValueMultiplier: context.buildSchedulerLinkValueMultiplier(
        buildExpectedSchedulerScoreSum([2, 7])
      ),
    },
    tab: {
      scoreSum: buildExpectedSchedulerScoreSum([5]),
      candidateCount: 1,
      linkValueMultiplier: context.buildSchedulerLinkValueMultiplier(
        buildExpectedSchedulerScoreSum([5])
      ),
    },
  }
);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      context.buildPreloadSchedulerScoreSignals(mixedCandidateLinks, browserNativeOnlySettings)
    )
  ),
  {
    native: {
      scoreSum: buildExpectedSchedulerScoreSum([2, 5, 7]),
      candidateCount: 3,
      linkValueMultiplier: context.buildSchedulerLinkValueMultiplier(
        buildExpectedSchedulerScoreSum([2, 5, 7])
      ),
    },
    tab: {
      scoreSum: 0,
      candidateCount: 0,
      linkValueMultiplier: 1,
    },
  }
);

const preloadState = context.createEmptyPreloadState();
const snapshots = [
  buildSnapshot({
    sourceTabId: 1,
    sourcePageUrl: "https://source.example/a",
    hiddenScores: [100, 100, 100, 100, 100, 100],
    nativeScores: [1, 1, 1, 1],
  }),
  buildSnapshot({
    sourceTabId: 2,
    sourcePageUrl: "https://source.example/b",
    hiddenScores: [1, 1, 1, 1, 1, 1],
    nativeScores: [50, 50, 50, 50],
  }),
];
const scheduledSelections = await schedulePreloadCandidateSelectionSnapshots({
  snapshots,
  preloadState,
  settings,
});

assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      scheduledSelections.map((entry) => [
        entry.sourceTabId,
        entry.tabSlots,
        entry.nativeSlots,
        entry.selection.tabTargets.length,
        entry.selection.prerenderTargets.length + entry.selection.prefetchTargets.length,
      ])
    )
  ),
  [
    [1, 1, 0, 1, 0],
    [2, 1, 4, 1, 4],
  ]
);

context.getPreloadResourcePressureState = async () => ({
  shouldDeferHiddenTabs: true,
  policy: "sleep",
  reason: "game-process",
});

const pressureScheduledSelections = await schedulePreloadCandidateSelectionSnapshots({
  snapshots,
  preloadState,
  settings,
});

delete context.getPreloadResourcePressureState;

assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      pressureScheduledSelections.map((entry) => [
        entry.sourceTabId,
        entry.tabSlots,
        entry.nativeSlots,
        entry.selection.tabTargets.length,
        entry.selection.selectedTargets.some((target) => target.strategy === "hidden-tab"),
      ])
    )
  ),
  [
    [1, 0, 0, 0, false],
    [2, 0, 4, 0, false],
  ]
);

const bookmarkOnlySelections = await schedulePreloadCandidateSelectionSnapshots({
  snapshots: [
    context.normalizePreloadCandidateSelectionSnapshot({
      sourceTabId: 5,
      sourceWindowId: 10,
      sourcePageUrl: "https://www.google.com/search?q=bookmark-only",
      updatedAt: "2026-01-01T00:00:00.000Z",
      scoreSignals: {
        tab: { scoreSum: 0, candidateCount: 0 },
        native: { scoreSum: 0, candidateCount: 0 },
      },
      selectedTargets: [
        buildTarget(5, "hidden-tab", 0, 0, {
          bookmarkPreload: {
            bucketKey: "startupGoogleSearch",
            count: 12,
            rank: 1,
            title: "Bookmark target",
          },
        }),
      ],
    }),
  ],
  preloadState,
  settings: bookmarkEnabledSettings,
});

assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      bookmarkOnlySelections.map((entry) => [
        entry.sourceTabId,
        entry.tabSlots,
        entry.nativeSlots,
        entry.selection.tabTargets.length,
      ])
    )
  ),
  [[5, 0, 0, 1]]
);

context.getPreloadResourcePressureState = async () => ({
  shouldDeferHiddenTabs: true,
  policy: "sleep",
  reason: "non-chrome-fullscreen",
});

const bookmarkPressureSelections = await schedulePreloadCandidateSelectionSnapshots({
  snapshots: [
    context.normalizePreloadCandidateSelectionSnapshot({
      sourceTabId: 6,
      sourceWindowId: 10,
      sourcePageUrl: "https://www.google.com/search?q=bookmark-pressure",
      updatedAt: "2026-01-01T00:00:00.000Z",
      scoreSignals: {
        tab: { scoreSum: 0, candidateCount: 0 },
        native: { scoreSum: 0, candidateCount: 0 },
      },
      selectedTargets: [
        buildTarget(6, "hidden-tab", 0, 0, {
          bookmarkPreload: {
            bucketKey: "startupGoogleSearch",
            count: 12,
            rank: 1,
            title: "Bookmark target",
          },
        }),
      ],
    }),
  ],
  preloadState,
  settings: bookmarkEnabledSettings,
});

delete context.getPreloadResourcePressureState;

assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      bookmarkPressureSelections.map((entry) => [
        entry.sourceTabId,
        entry.tabSlots,
        entry.nativeSlots,
        entry.selection.tabTargets.length,
      ])
    )
  ),
  [[6, 0, 0, 0]]
);

const bookmarkDisabledSelections = await schedulePreloadCandidateSelectionSnapshots({
  snapshots: [
    context.normalizePreloadCandidateSelectionSnapshot({
      sourceTabId: 6,
      sourceWindowId: 10,
      sourcePageUrl: "https://www.google.com/search?q=bookmark-disabled",
      updatedAt: "2026-01-01T00:00:00.000Z",
      scoreSignals: {
        tab: { scoreSum: 0, candidateCount: 0 },
        native: { scoreSum: 0, candidateCount: 0 },
      },
      selectedTargets: [
        buildTarget(6, "hidden-tab", 0, 0, {
          bookmarkPreload: {
            bucketKey: "startupGoogleSearch",
            count: 12,
            rank: 1,
            title: "Bookmark target",
          },
        }),
      ],
    }),
  ],
  preloadState,
  settings,
});

assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      bookmarkDisabledSelections.map((entry) => [
        entry.sourceTabId,
        entry.tabSlots,
        entry.nativeSlots,
        entry.selection.tabTargets.length,
      ])
    )
  ),
  [[6, 0, 0, 0]]
);

const proxySkipSettings = context.ZeroLatencySettings.resolveEffectiveSettings({
  ...context.ZeroLatencySettings.DEFAULT_SETTINGS,
  preloading: {
    ...context.ZeroLatencySettings.DEFAULT_SETTINGS.preloading,
    realPreloadEnabled: true,
    proxySkip: {
      enabled: true,
      mode: "blacklist",
      rules: ["proxied-source.example", "proxied-target.example"],
    },
    scheduler: {
      ...context.ZeroLatencySettings.DEFAULT_SETTINGS.preloading.scheduler,
      nativeTotalMin: 4,
      nativeTotalMax: 4,
      tabTotalMin: 5,
      tabTotalMax: 5,
    },
  },
});

const proxySourceSkippedSelections = await schedulePreloadCandidateSelectionSnapshots({
  snapshots: [
    buildSnapshot({
      sourceTabId: 7,
      sourcePageUrl: "https://proxied-source.example/page",
      hiddenScores: [10],
      nativeScores: [10],
    }),
  ],
  preloadState,
  settings: proxySkipSettings,
});

assert.deepEqual(JSON.parse(JSON.stringify(proxySourceSkippedSelections)), []);

const proxyTargetSkippedSelections = await schedulePreloadCandidateSelectionSnapshots({
  snapshots: [
    context.normalizePreloadCandidateSelectionSnapshot({
      sourceTabId: 8,
      sourceWindowId: 10,
      sourcePageUrl: "https://direct-source.example/page",
      updatedAt: "2026-01-01T00:00:00.000Z",
      scoreSignals: {
        tab: { scoreSum: 200, candidateCount: 2 },
        native: { scoreSum: 0, candidateCount: 0 },
      },
      selectedTargets: [
        buildTarget(8, "hidden-tab", 100, 0, {
          url: "https://proxied-target.example/page",
        }),
        buildTarget(8, "hidden-tab", 10, 1, {
          url: "https://direct-target.example/page",
        }),
      ],
    }),
  ],
  preloadState,
  settings: proxySkipSettings,
});

assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      proxyTargetSkippedSelections.map((entry) =>
        entry.selection.tabTargets.map((target) => target.url)
      )
    )
  ),
  [["https://direct-target.example/page"]]
);

const signalDrivenSelections = await schedulePreloadCandidateSelectionSnapshots({
  snapshots: [
    buildSnapshot({
      sourceTabId: 3,
      sourcePageUrl: "https://source.example/signal-a",
      hiddenScores: [1, 1, 1, 1, 1, 1],
      nativeScores: [],
      scoreSignals: {
        tab: { scoreSum: 1000, candidateCount: 6 },
        native: { scoreSum: 0, candidateCount: 0 },
      },
    }),
    buildSnapshot({
      sourceTabId: 4,
      sourcePageUrl: "https://source.example/signal-b",
      hiddenScores: [100, 100, 100, 100, 100, 100],
      nativeScores: [],
      scoreSignals: {
        tab: { scoreSum: 1, candidateCount: 6 },
        native: { scoreSum: 0, candidateCount: 0 },
      },
    }),
  ],
  preloadState,
  settings,
});

assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      signalDrivenSelections.map((entry) => [
        entry.sourceTabId,
        entry.tabSlots,
        entry.selection.tabTargets.length,
      ])
    )
  ),
  [
    [3, 1, 1],
    [4, 1, 1],
  ]
);

let rebuiltSlotLimits = null;
let rebuiltIgnoredConfiguredSourceSlotCaps = null;
context.selectPreloadTargets = async (request) => {
  rebuiltSlotLimits = request.slotLimits;
  rebuiltIgnoredConfiguredSourceSlotCaps = request.ignoreConfiguredSourceSlotCaps === true;
  return context.ZeroLatencyPreloadSchedulerSelections.buildSelectionFromTargets([
    ...request.candidateLinks
      .filter((link) => link.url.includes("/hidden-tab/"))
      .map((link, index) => buildTarget(7, "hidden-tab", 20 - index, index))
      .slice(0, request.slotLimits.tabPageSlotLimit),
    ...request.candidateLinks
      .filter((link) => !link.url.includes("/hidden-tab/"))
      .map((link, index) => buildTarget(7, "prerender", 10 - index, index))
      .slice(0, request.slotLimits.nativePageSlotLimit),
  ]);
};

const rebuiltSelections = await schedulePreloadCandidateSelectionSnapshots({
  snapshots: [
    context.normalizePreloadCandidateSelectionSnapshot({
      sourceTabId: 7,
      sourceWindowId: 10,
      sourcePageUrl: "https://source.example/rebuild",
      currentNodeId: "https://source.example",
      updatedAt: "2026-01-01T00:00:00.000Z",
      candidateLinks: [
        buildCandidateLink(7, "hidden-tab", 0),
        buildCandidateLink(7, "hidden-tab", 1),
        buildCandidateLink(7, "prerender", 0),
      ],
      selectedTargets: [
        buildTarget(7, "hidden-tab", 10, 0),
        buildTarget(7, "hidden-tab", 9, 1),
        buildTarget(7, "prerender", 8, 0),
      ],
    }),
  ],
  preloadState,
  settings,
  graph: { nodes: {} },
});

assert.deepEqual(JSON.parse(JSON.stringify(rebuiltSlotLimits)), {
  nativePageSlotLimit: 1,
  tabPageSlotLimit: 1,
});
assert.equal(rebuiltIgnoredConfiguredSourceSlotCaps, false);
assert.deepEqual(
  JSON.parse(
    JSON.stringify([
      rebuiltSelections[0].selection.tabTargets.length,
      rebuiltSelections[0].selection.prerenderTargets.length,
    ])
  ),
  [1, 1]
);

const rescheduleState = context.createEmptyPreloadState();
rescheduleState.scheduler.candidateSelectionSnapshotsByTabId = {
  30: buildSnapshot({
    sourceTabId: 30,
    sourcePageUrl: "https://source.example/stored-a",
    hiddenScores: [10, 9, 8, 7, 6, 5],
    nativeScores: [],
    scoreSignals: {
      tab: {
        scoreSum: buildExpectedSchedulerScoreSum([10, 9, 8, 7, 6, 5]),
        candidateCount: 6,
        linkValueMultiplier: context.buildSchedulerLinkValueMultiplier(
          buildExpectedSchedulerScoreSum([10, 9, 8, 7, 6, 5])
        ),
      },
      native: { scoreSum: 0, candidateCount: 0, linkValueMultiplier: 1 },
    },
  }),
  40: buildSnapshot({
    sourceTabId: 40,
    sourcePageUrl: "https://source.example/stored-b",
    hiddenScores: [100, 90, 80, 70, 60, 50],
    nativeScores: [],
    scoreSignals: {
      tab: {
        scoreSum: buildExpectedSchedulerScoreSum([100, 90, 80, 70, 60, 50]),
        candidateCount: 6,
        linkValueMultiplier: context.buildSchedulerLinkValueMultiplier(
          buildExpectedSchedulerScoreSum([100, 90, 80, 70, 60, 50])
        ),
      },
      native: { scoreSum: 0, candidateCount: 0, linkValueMultiplier: 1 },
    },
  }),
};
rescheduleState.scheduler.attentionPool =
  context.ZeroLatencyPreloadSchedulerAttention.appendPreloadAttentionDuration(
    rescheduleState.scheduler.attentionPool,
    {
      tabId: 30,
      windowId: 10,
      pageUrl: "https://source.example/stored-a",
      durationMs: 60000,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:01:00.000Z",
    }
  );

context.chrome = {
  tabs: {
    query: async () => [
      { id: 30, windowId: 10, active: false, url: "https://source.example/stored-a" },
      { id: 40, windowId: 10, active: false, url: "https://source.example/stored-b" },
    ],
    sendMessage: async () => undefined,
  },
};
const synchronizedSelections = [];
context.synchronizePreloadsForSourceTab = async (state, windowId, tabId, targets) => {
  synchronizedSelections.push(["hidden-tab", windowId, tabId, targets.length]);
  return state;
};
context.synchronizePrerenderEntriesForSourceTab = (state, windowId, tabId, targets) => {
  synchronizedSelections.push(["prerender", windowId, tabId, targets.length]);
  return state;
};
context.synchronizePrefetchEntriesForSourceTab = (state, windowId, tabId, targets) => {
  synchronizedSelections.push(["prefetch", windowId, tabId, targets.length]);
  return state;
};
rebuiltSlotLimits = null;
const storedRescheduleResult = await rescheduleStoredPreloadSelections(rescheduleState, {
  settings,
});

assert.equal(rebuiltSlotLimits, null);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      storedRescheduleResult.scheduledSelections.map((entry) => [
        entry.sourceTabId,
        entry.tabSlots,
        entry.selection.tabTargets.length,
      ])
    )
  ),
  [
    [30, 1, 1],
    [40, 0, 0],
  ]
);
assert.deepEqual(JSON.parse(JSON.stringify(synchronizedSelections)), [
  ["hidden-tab", 10, 30, 1],
  ["prerender", 10, 30, 0],
  ["prefetch", 10, 30, 0],
  ["hidden-tab", 10, 40, 0],
  ["prerender", 10, 40, 0],
  ["prefetch", 10, 40, 0],
]);

const rememberedState = context.createEmptyPreloadState();
let savedRememberedState = null;
let wideSelectionRequest = null;
context.selectPreloadTargetsFromScoredCandidatePool = async (request) => {
  wideSelectionRequest = request;
  return context.ZeroLatencyPreloadSchedulerSelections.buildSelectionFromTargets([
    buildTarget(50, "hidden-tab", 100, 0),
    buildTarget(50, "hidden-tab", 90, 1),
    buildTarget(50, "prerender", 80, 0),
  ]);
};
context.queueMutation = async (task) => task();
context.loadPreloadState = async () => rememberedState;
context.savePreloadState = async (state) => {
  savedRememberedState = state;
};
context.synchronizePreloadsForSourceTab = async (state) => state;
context.synchronizePrerenderEntriesForSourceTab = (state) => state;
context.synchronizePrefetchEntriesForSourceTab = (state) => state;
context.chrome = {
  tabs: {
    query: async () => [
      { id: 50, windowId: 10, active: true, url: "https://source.example/apply" },
    ],
    sendMessage: async () => undefined,
  },
};

await applyPreloadSchedulerCandidateSelection({
  sourceTab: {
    id: 50,
    windowId: 10,
    title: "Apply",
    url: "https://source.example/apply",
  },
  sourceTabId: 50,
  sourcePageUrl: "https://source.example/apply",
  currentNodeId: "https://source.example",
  message: {
    pageTitle: "Apply",
    links: [buildCandidateLink(50, "hidden-tab", 0)],
  },
  selection: null,
  scoredCandidatePool: [
    {
      url: "https://target.example/50/hidden-tab/0",
      nodeId: "https://target.example/50",
      score: 100,
      isSameOrigin: false,
      outboundPageTransitionCount: 1,
      targetHint: "_blank",
    },
    {
      url: "https://target.example/50/prerender/0",
      nodeId: "https://target.example/50",
      score: 80,
      isSameOrigin: true,
      targetHint: "_self",
    },
  ],
  settings,
  graph: { nodes: {} },
});

const rememberedSnapshot =
  savedRememberedState.scheduler.candidateSelectionSnapshotsByTabId["50"];

assert.equal(wideSelectionRequest.slotLimits.nativePageSlotLimit, 4);
assert.equal(wideSelectionRequest.slotLimits.tabPageSlotLimit, 5);
assert.equal(wideSelectionRequest.ignoreConfiguredSourceSlotCaps, true);
assert.equal(rememberedSnapshot.selectedTargets.length, 3);
assert.equal(rememberedSnapshot.scoreSignals.tab.scoreSum, buildExpectedSchedulerScoreSum([100]));
assert.equal(
  rememberedSnapshot.scoreSignals.native.scoreSum,
  buildExpectedSchedulerScoreSum([80])
);

const oldHiddenSnapshot = buildSnapshot({
  sourceTabId: 60,
  sourcePageUrl: "https://source.example/native-only",
  hiddenScores: [90, 80],
  nativeScores: [70],
  scoreSignals: {
    native: {
      scoreSum: buildExpectedSchedulerScoreSum([70]),
      candidateCount: 1,
    },
    tab: {
      scoreSum: buildExpectedSchedulerScoreSum([90, 80]),
      candidateCount: 2,
    },
  },
});
const nativeOnlySelections = await schedulePreloadCandidateSelectionSnapshots({
  snapshots: [oldHiddenSnapshot],
  preloadState: context.createEmptyPreloadState(),
  settings: browserNativeOnlySettings,
  graph: null,
});

assert.equal(nativeOnlySelections.length, 1);
assert.equal(nativeOnlySelections[0].tabSlots, 0);
assert.ok(nativeOnlySelections[0].nativeSlots >= 1);
assert.equal(nativeOnlySelections[0].selection.tabTargets.length, 0);
assert.equal(
  nativeOnlySelections[0].selection.selectedTargets.some(
    (target) => target.strategy === "hidden-tab"
  ),
  false
);
assert.ok(
  nativeOnlySelections[0].selection.selectedTargets.some(
    (target) =>
      target.url === "https://target.example/60/hidden-tab/0" &&
      target.strategy === "prefetch"
  )
);

function buildSnapshot({ sourceTabId, sourcePageUrl, hiddenScores, nativeScores, scoreSignals }) {
  return context.normalizePreloadCandidateSelectionSnapshot({
    sourceTabId,
    sourceWindowId: 10,
    sourcePageUrl,
    updatedAt: "2026-01-01T00:00:00.000Z",
    scoreSignals,
    selectedTargets: [
      ...hiddenScores.map((score, index) =>
        buildTarget(sourceTabId, "hidden-tab", score, index)
      ),
      ...nativeScores.map((score, index) =>
        buildTarget(sourceTabId, index % 2 === 0 ? "prerender" : "prefetch", score, index)
      ),
    ],
  });
}

function buildTarget(sourceTabId, strategy, score, index, extra = {}) {
  return {
    url: `https://target.example/${sourceTabId}/${strategy}/${index}`,
    nodeId: `https://target.example/${sourceTabId}`,
    score,
    targetHint: "_self",
    strategy,
    ...extra,
  };
}

function buildCandidateLink(sourceTabId, strategy, index) {
  return {
    url: `https://target.example/${sourceTabId}/${strategy}/${index}`,
    targetHint: "_self",
    visibility: 100,
    strategy,
  };
}

function buildExpectedSchedulerScoreSum(scores) {
  return (Array.isArray(scores) ? scores : []).reduce(
    (sum, score) => sum + buildExpectedSchedulerLinkScoreSignal(score),
    0
  );
}

function buildExpectedSchedulerLinkScoreSignal(score) {
  const normalizedScore = Number(score);

  if (!Number.isFinite(normalizedScore) || normalizedScore <= 0) {
    return 0;
  }

  return normalizedScore ** 1.5;
}

console.log("preload scheduler selection tests passed");
