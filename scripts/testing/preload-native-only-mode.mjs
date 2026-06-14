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
  ["extansion", "background", "preload", "state", "model.js"],
  ["extansion", "background", "preload", "state", "lookup", "normal-windows.js"],
  ["extansion", "background", "preload", "state", "lookup", "source-tabs.js"],
  ["extansion", "background", "preload", "state", "lookup", "pruning.js"],
  ["extansion", "background", "preload", "native-only-policy.js"],
  ["extansion", "background", "preload", "prediction", "strategy", "flags.js"],
  ["extansion", "background", "preload", "prediction", "strategy", "scenario.js"],
  ["extansion", "background", "preload", "prediction", "strategy", "same-origin.js"],
  ["extansion", "background", "preload", "prediction", "strategy", "cross-site-current-tab.js"],
  ["extansion", "background", "preload", "prediction", "strategy", "cross-site-new-tab.js"],
  ["extansion", "background", "preload", "prediction", "strategy-router.js"],
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
const allNativeSettings = settingsApi.resolveEffectiveSettings({
  ...settingsApi.DEFAULT_SETTINGS,
  preloading: {
    ...settingsApi.DEFAULT_SETTINGS.preloading,
    allNativePreloadMode: true,
  },
  experiments: {
    ...settingsApi.DEFAULT_SETTINGS.experiments,
    crossSiteCurrentTabSwap: true,
  },
});
const regularSettings = settingsApi.resolveEffectiveSettings({
  ...settingsApi.DEFAULT_SETTINGS,
  experiments: {
    ...settingsApi.DEFAULT_SETTINGS.experiments,
    crossSiteCurrentTabSwap: true,
  },
});
context.currentSettings = allNativeSettings;

assert.equal(allNativeSettings.preloading.allNativePreloadMode, true);
assert.equal(allNativeSettings.experiments.crossSiteCurrentTabSwap, false);
assert.equal(
  context.determinePreloadStrategy(
    {
      url: "https://target.example/page",
      isSameOrigin: false,
      targetHint: "_blank",
      outboundPageTransitionCount: 3,
    },
    regularSettings
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
    allNativeSettings
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
    allNativeSettings
  ),
  "prerender"
);
await context.ZeroLatencyPreloadNativeOnlyPolicy.resetNativeAppModeWarningState();
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      context.ZeroLatencyPreloadNativeOnlyPolicy.peekNativeAppModeWarning(
        regularSettings,
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
        regularSettings,
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
      regularSettings,
      { now: 60999 }
    )
  ).active,
  false
);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      await context.ZeroLatencyPreloadNativeOnlyPolicy.buildNativeAppModeWarning(
        regularSettings,
        { now: 61000 }
      )
    )
  ),
  {
    active: true,
    reason: "native-app-unavailable",
    messageKey: "nativeAppMissingDownloadOrEnableAllNativePreloadMode",
    messageFallback:
      "Native app has not been detected for 1 minute. Download the native app or enable all-native preload mode.",
    observedAtMs: 1000,
    delayMs: 60000,
  }
);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      context.ZeroLatencyPreloadNativeOnlyPolicy.peekNativeAppModeWarning(
        regularSettings,
        { now: 61000 }
      )
    )
  ),
  {
    active: true,
    reason: "native-app-unavailable",
    messageKey: "nativeAppMissingDownloadOrEnableAllNativePreloadMode",
    messageFallback:
      "Native app has not been detected for 1 minute. Download the native app or enable all-native preload mode.",
    observedAtMs: 1000,
    delayMs: 60000,
  }
);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      await context.ZeroLatencyPreloadNativeOnlyPolicy.buildNativeAppModeWarning(allNativeSettings)
    )
  ),
  { active: false }
);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      await context.ZeroLatencyPreloadNativeOnlyPolicy.buildNativeAppModeWarning(
        regularSettings,
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
    settings: regularSettings,
    now: 90000,
  }
);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      await context.ZeroLatencyPreloadNativeOnlyPolicy.buildNativeAppModeWarning(
        regularSettings,
        { now: 150000 }
      )
    )
  ),
  {
    active: true,
    reason: "native-app-unavailable",
    messageKey: "nativeAppMissingDownloadOrEnableAllNativePreloadMode",
    messageFallback:
      "Native app has not been detected for 1 minute. Download the native app or enable all-native preload mode.",
    observedAtMs: 90000,
    delayMs: 60000,
  }
);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      context.ZeroLatencyPreloadNativeOnlyPolicy.peekNativeAppModeWarning(
        regularSettings,
        { now: 150000 }
      )
    )
  ),
  {
    active: true,
    reason: "native-app-unavailable",
    messageKey: "nativeAppMissingDownloadOrEnableAllNativePreloadMode",
    messageFallback:
      "Native app has not been detected for 1 minute. Download the native app or enable all-native preload mode.",
    observedAtMs: 90000,
    delayMs: 60000,
  }
);
await context.ZeroLatencyPreloadNativeOnlyPolicy.handleSystemLevelWindowHidingUsabilityChange(
  true,
  {
    settings: regularSettings,
    now: 150001,
  }
);
context.ZeroLatencySupport.isSystemLevelWindowHidingUsable = () => true;
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      await context.ZeroLatencyPreloadNativeOnlyPolicy.buildNativeAppModeWarning(
        regularSettings,
        { now: 150001 }
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
    allNativeSettings,
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
