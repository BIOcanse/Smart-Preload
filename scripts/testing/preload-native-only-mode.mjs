import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPaths = [
  ["extension", "shared", "settings", "utils.js"],
  ["extension", "shared", "settings", "schema", "localize.js"],
  ["extension", "shared", "settings", "schema", "constants.js"],
  ["extension", "shared", "settings", "schema", "options.js"],
  ["extension", "shared", "settings", "schema", "rule-cards.js"],
  ["extension", "shared", "settings", "schema.js"],
  ["extension", "shared", "settings", "defaults.js"],
  ["extension", "shared", "settings", "rules.js"],
  ["extension", "shared", "settings", "proxy-skip.js"],
  ["extension", "shared", "settings", "ai.js"],
  ["extension", "shared", "settings", "effective.js"],
  ["extension", "shared", "settings", "normalize", "appearance-layout.js"],
  ["extension", "shared", "settings", "normalize", "preload.js"],
  ["extension", "shared", "settings", "normalize", "scheduler.js"],
  ["extension", "shared", "settings", "normalize.js"],
  ["extension", "shared", "settings", "storage.js"],
  ["extension", "shared", "settings.js"],
  ["extension", "background", "shared", "base.js"],
  ["extension", "background", "preload", "state", "model.js"],
  ["extension", "background", "preload", "state", "lookup", "normal-windows.js"],
  ["extension", "background", "preload", "state", "lookup", "source-tabs.js"],
  ["extension", "background", "preload", "state", "lookup", "pruning.js"],
  ["extension", "background", "preload", "native-only-policy", "constants.js"],
  ["extension", "background", "preload", "native-only-policy", "mode.js"],
  ["extension", "background", "preload", "native-only-policy", "cleanup.js"],
  ["extension", "background", "preload", "native-only-policy", "warning-storage.js"],
  ["extension", "background", "preload", "native-only-policy", "app-warning.js"],
  ["extension", "background", "preload", "native-only-policy", "real-preload-recommendation.js"],
  ["extension", "background", "preload", "native-only-policy.js"],
  ["extension", "background", "preload", "prediction", "strategy", "flags.js"],
  ["extension", "background", "preload", "prediction", "strategy", "scenario.js"],
  ["extension", "background", "preload", "prediction", "strategy", "same-origin.js"],
  ["extension", "background", "preload", "prediction", "strategy", "cross-site-current-tab.js"],
  ["extension", "background", "preload", "prediction", "strategy", "cross-site-new-tab.js"],
  ["extension", "background", "preload", "prediction", "strategy", "resolver.js"],
  ["extension", "background", "preload", "prediction", "strategy", "signals.js"],
  ["extension", "background", "preload", "prediction", "strategy", "selection.js"],
  ["extension", "background", "preload", "prediction", "strategy-router.js"],
].map((segments) => path.join(repoRoot, ...segments));

const context = {
  console,
  Date,
  Number,
  URL,
  navigator: {
    hardwareConcurrency: 8,
    deviceMemory: 8,
    userAgent: "node-test",
  },
};
context.globalThis = context;
context.closedTabIds = [];
context.ZeroLatencyDebugEvents = {
  events: [],
  record(name, payload) {
    this.events.push({ name, payload });
  },
};
context.ZeroLatencySupport = {
  supportsHiddenTabPreloadRuntime: () => true,
  supportsSystemLevelWindowHiding: () => true,
  isSystemLevelWindowHidingUsable: () => false,
};
context.closeTabIfExists = async (tabId) => {
  context.closedTabIds.push(tabId);
};
context.getEffectiveExtensionSettings = () => context.currentSettings;
context.ZeroLatencyPreloadWindowManager = {
  async closeWindowForNormalWindow(preloadState, normalWindowId) {
    const runtime = context.getNormalWindowRuntime(preloadState, normalWindowId);

    if (!runtime?.preloadWindow?.windowId) {
      return false;
    }

    runtime.preloadWindow.windowId = null;
    runtime.preloadWindow.hwnd = null;
    runtime.preloadWindow.hiddenBySystem = false;
    return true;
  },
};

vm.createContext(context);

for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

const settingsApi = context.ZeroLatencySettings;
const browserNativeOnlySettings = settingsApi.resolveEffectiveSettings({
  ...settingsApi.DEFAULT_SETTINGS,
  preloading: {
    ...settingsApi.DEFAULT_SETTINGS.preloading,
    realPreloadEnabled: false,
  },
  experiments: {
    ...settingsApi.DEFAULT_SETTINGS.experiments,
    crossSiteCurrentTabSwap: true,
  },
});
const realPreloadSettings = settingsApi.resolveEffectiveSettings({
  ...settingsApi.DEFAULT_SETTINGS,
  preloading: {
    ...settingsApi.DEFAULT_SETTINGS.preloading,
    realPreloadEnabled: true,
  },
  experiments: {
    ...settingsApi.DEFAULT_SETTINGS.experiments,
    crossSiteCurrentTabSwap: true,
  },
});
context.currentSettings = browserNativeOnlySettings;

assert.equal(browserNativeOnlySettings.preloading.realPreloadEnabled, false);
assert.equal(browserNativeOnlySettings.experiments.crossSiteCurrentTabSwap, false);
assert.equal(realPreloadSettings.preloading.realPreloadEnabled, true);
assert.equal(realPreloadSettings.experiments.crossSiteCurrentTabSwap, true);
assert.equal(
  context.determinePreloadStrategy(
    {
      url: "https://target.example/page",
      isSameOrigin: false,
      targetHint: "_blank",
      outboundPageTransitionCount: 3,
    },
    realPreloadSettings
  ),
  "hidden-tab"
);
assert.equal(
  context.determinePreloadStrategy(
    {
      url: "https://target.example/page",
      isSameOrigin: false,
      targetHint: "_blank",
      outboundPageTransitionCount: 3,
    },
    browserNativeOnlySettings
  ),
  "prefetch"
);
assert.equal(
  context.determinePreloadStrategy(
    {
      url: "https://same.example/next",
      isSameOrigin: true,
      targetHint: "_self",
    },
    browserNativeOnlySettings
  ),
  "prerender"
);
await context.ZeroLatencyPreloadNativeOnlyPolicy.resetNativeAppModeWarningState();
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      context.ZeroLatencyPreloadNativeOnlyPolicy.peekNativeAppModeWarning(
        realPreloadSettings,
        { now: 1000 }
      )
    )
  ),
  {
    active: false,
    reason: "native-app-warning-cache-unavailable",
  }
);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      await context.ZeroLatencyPreloadNativeOnlyPolicy.buildNativeAppModeWarning(
        realPreloadSettings,
        { now: 1000 }
      )
    )
  ),
  {
    active: false,
    pending: true,
    reason: "native-app-unavailable-pending",
    observedAtMs: 1000,
    delayMs: 60000,
    remainingMs: 60000,
  }
);
assert.equal(
  (
    await context.ZeroLatencyPreloadNativeOnlyPolicy.buildNativeAppModeWarning(
      realPreloadSettings,
      { now: 60999 }
    )
  ).active,
  false
);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      await context.ZeroLatencyPreloadNativeOnlyPolicy.buildNativeAppModeWarning(
        realPreloadSettings,
        { now: 61000 }
      )
    )
  ),
  {
    active: true,
    reason: "native-app-unavailable",
    messageKey: "nativeAppMissingDownloadOrDisableRealPreload",
    messageFallback:
      "Real Preload needs the Windows app. It has not been detected for 1 minute; install the app or turn off Real Preload.",
    observedAtMs: 1000,
    delayMs: 60000,
  }
);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      context.ZeroLatencyPreloadNativeOnlyPolicy.peekNativeAppModeWarning(
        realPreloadSettings,
        { now: 61000 }
      )
    )
  ),
  {
    active: true,
    reason: "native-app-unavailable",
    messageKey: "nativeAppMissingDownloadOrDisableRealPreload",
    messageFallback:
      "Real Preload needs the Windows app. It has not been detected for 1 minute; install the app or turn off Real Preload.",
    observedAtMs: 1000,
    delayMs: 60000,
  }
);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      await context.ZeroLatencyPreloadNativeOnlyPolicy.buildNativeAppModeWarning(
        browserNativeOnlySettings
      )
    )
  ),
  { active: false }
);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      await context.ZeroLatencyPreloadNativeOnlyPolicy.buildNativeAppModeWarning(
        realPreloadSettings,
        { now: 70000 }
      )
    )
  ),
  {
    active: false,
    pending: true,
    reason: "native-app-unavailable-pending",
    observedAtMs: 70000,
    delayMs: 60000,
    remainingMs: 60000,
  }
);
await context.ZeroLatencyPreloadNativeOnlyPolicy.resetNativeAppModeWarningState();
await context.ZeroLatencyPreloadNativeOnlyPolicy.handleSystemLevelWindowHidingUsabilityChange(
  false,
  {
    settings: realPreloadSettings,
    now: 90000,
  }
);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      await context.ZeroLatencyPreloadNativeOnlyPolicy.buildNativeAppModeWarning(
        realPreloadSettings,
        { now: 150000 }
      )
    )
  ),
  {
    active: true,
    reason: "native-app-unavailable",
    messageKey: "nativeAppMissingDownloadOrDisableRealPreload",
    messageFallback:
      "Real Preload needs the Windows app. It has not been detected for 1 minute; install the app or turn off Real Preload.",
    observedAtMs: 90000,
    delayMs: 60000,
  }
);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      context.ZeroLatencyPreloadNativeOnlyPolicy.peekNativeAppModeWarning(
        realPreloadSettings,
        { now: 150000 }
      )
    )
  ),
  {
    active: true,
    reason: "native-app-unavailable",
    messageKey: "nativeAppMissingDownloadOrDisableRealPreload",
    messageFallback:
      "Real Preload needs the Windows app. It has not been detected for 1 minute; install the app or turn off Real Preload.",
    observedAtMs: 90000,
    delayMs: 60000,
  }
);
await context.ZeroLatencyPreloadNativeOnlyPolicy.handleSystemLevelWindowHidingUsabilityChange(
  true,
  {
    settings: realPreloadSettings,
    now: 150001,
  }
);
context.ZeroLatencySupport.isSystemLevelWindowHidingUsable = () => true;
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      await context.ZeroLatencyPreloadNativeOnlyPolicy.buildNativeAppModeWarning(
        realPreloadSettings,
        { now: 150001 }
      )
    )
  ),
  { active: false }
);
context.ZeroLatencySupport.isSystemLevelWindowHidingUsable = () => false;

assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      await context.ZeroLatencyPreloadNativeOnlyPolicy.buildNativeAppModeWarning(
        browserNativeOnlySettings,
        { now: 200000 }
      )
    )
  ),
  { active: false }
);
context.ZeroLatencySupport.isSystemLevelWindowHidingUsable = () => true;
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      context.ZeroLatencyPreloadNativeOnlyPolicy.buildRealPreloadRecommendationWarning(
        browserNativeOnlySettings,
        {
          metrics: {
            totalMemoryBytes: 16 * 1024 * 1024 * 1024,
          },
        }
      )
    )
  ),
  {
    active: true,
    reason: "real-preload-low-memory",
    messageKey: "realPreloadAvailableLowMemoryWarning",
    messageFallback:
      "Real Preload is available and can reduce perceived latency to zero, but this computer has less than 24 GB of memory; it is not recommended for most users.",
    totalMemoryBytes: 16 * 1024 * 1024 * 1024,
    thresholdMemoryBytes: 24 * 1024 * 1024 * 1024,
  }
);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      context.ZeroLatencyPreloadNativeOnlyPolicy.buildRealPreloadRecommendationWarning(
        browserNativeOnlySettings,
        {
          metrics: {
            totalMemoryBytes: 32 * 1024 * 1024 * 1024,
          },
        }
      )
    )
  ),
  {
    active: true,
    reason: "real-preload-recommended",
    messageKey: "realPreloadRecommendedWarning",
    messageFallback:
      "Real Preload is available and recommended on this machine. It can reduce perceived latency to zero, but uses a lot of memory; avoid overly aggressive limits.",
    totalMemoryBytes: 32 * 1024 * 1024 * 1024,
    thresholdMemoryBytes: 24 * 1024 * 1024 * 1024,
  }
);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      context.ZeroLatencyPreloadNativeOnlyPolicy.buildRealPreloadRecommendationWarning(
        realPreloadSettings,
        {
          metrics: {
            totalMemoryBytes: 32 * 1024 * 1024 * 1024,
          },
        }
      )
    )
  ),
  { active: false }
);
context.ZeroLatencySupport.isSystemLevelWindowHidingUsable = () => false;

const preloadState = context.createEmptyPreloadState();
const normalWindowRuntime = context.ensureNormalWindowRuntime(preloadState, 10);
normalWindowRuntime.preloadWindow.windowId = 99;
normalWindowRuntime.sourceTabs["1"] = {
  sourceTabId: 1,
  hiddenTabEntriesByUrl: {
    "https://hidden.example/a": {
      tabId: 101,
      requestedUrl: "https://hidden.example/a",
      loadedUrl: "https://hidden.example/a",
      status: "complete",
    },
  },
  prerenderEntriesByUrl: {
    "https://native.example/prerender": {
      requestedUrl: "https://native.example/prerender",
      status: "prerender",
      strategy: "prerender",
    },
  },
  prefetchEntriesByUrl: {
    "https://native.example/prefetch": {
      requestedUrl: "https://native.example/prefetch",
      status: "prefetch",
      strategy: "prefetch",
    },
  },
  updatedAt: null,
};

const cleanup =
  await context.ZeroLatencyPreloadNativeOnlyPolicy.clearHiddenTabPreloadStateForNativeOnlyMode(
    preloadState,
    browserNativeOnlySettings,
    {
      reason: "test",
    }
  );

assert.equal(cleanup.mutated, true);
assert.deepEqual(JSON.parse(JSON.stringify(context.closedTabIds)), [101]);
assert.deepEqual(JSON.parse(JSON.stringify(cleanup.closedWindowIds)), [99]);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      preloadState.normalWindowsById["10"].sourceTabs["1"].hiddenTabEntriesByUrl
    )
  ),
  {}
);
assert.ok(
  preloadState.normalWindowsById["10"].sourceTabs["1"].prerenderEntriesByUrl[
    "https://native.example/prerender"
  ]
);
assert.ok(
  preloadState.normalWindowsById["10"].sourceTabs["1"].prefetchEntriesByUrl[
    "https://native.example/prefetch"
  ]
);

console.log("preload native-only mode tests passed");
