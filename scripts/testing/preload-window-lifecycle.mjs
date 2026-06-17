import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const scriptPaths = [
  ["extansion", "background", "preload", "runtime", "lifecycle", "windows", "warmup.js"],
  ["extansion", "background", "preload", "runtime", "lifecycle", "windows", "removed.js"],
  ["extansion", "background", "preload", "runtime", "lifecycle", "windows", "bounds.js"],
  ["extansion", "background", "preload", "runtime", "lifecycle", "windows.js"],
].map((segments) => path.join(repoRoot, ...segments));

const removedWindowIds = [];
const savedStates = [];
const hiddenMaintains = [];
let preloadState = {
  normalWindowsById: {
    "50": {
      normalWindowId: 50,
      preloadWindow: {
        windowId: 150,
        hiddenBySystem: false,
        hwnd: null,
      },
      sourceTabs: {},
    },
  },
};

const context = {
  console,
  Math,
  Number,
  Date,
  setTimeout,
  clearTimeout,
  PRELOAD_WINDOW_SENTINEL_URL: "chrome-extension://test/preload-window.html",
  chrome: {
    windows: {
      getAll: async () => [
        {
          id: 10,
          incognito: false,
          tabs: [{ id: 1, url: "https://source.test/" }],
        },
        {
          id: 20,
          incognito: false,
          tabs: [{ id: 2, url: "chrome-extension://test/preload-window.html" }],
        },
        {
          id: 30,
          incognito: true,
          tabs: [{ id: 3, url: "https://private.test/" }],
        },
      ],
      remove: async (windowId) => {
        removedWindowIds.push(windowId);
      },
    },
  },
  ZeroLatencySupport: {
    supportsHiddenTabPreloadRuntime: () => true,
    isSystemLevelWindowHidingUsable: () => true,
  },
  ZeroLatencyPreloadIncognitoPolicy: {
    isIncognitoPreloadExclusionEnabled: () => true,
  },
  ZeroLatencyDebugEvents: {
    records: [],
    record(name, payload) {
      this.records.push({ name, payload });
    },
  },
  ZeroLatencyPreloadWindowManager: {
    async maintainHiddenState(windowId, options) {
      hiddenMaintains.push({ windowId, trigger: options?.trigger || "" });
    },
  },
  normalizePositiveInteger(value, fallback = null) {
    const numericValue = Number(value);

    if (!Number.isInteger(numericValue) || numericValue <= 0) {
      return fallback;
    }

    return numericValue;
  },
  normalizeFiniteNumber(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  },
  async isExtensionServicePaused() {
    return false;
  },
  getEffectiveExtensionSettings() {
    return {
      preloading: {
        enabled: true,
      },
      preloadWindow: {
        forceMinimize: true,
      },
    };
  },
  async loadPreloadState() {
    return preloadState;
  },
  async savePreloadState(nextState) {
    preloadState = nextState;
    savedStates.push(JSON.parse(JSON.stringify(nextState)));
  },
  ensureNormalWindowRuntime(state, normalWindowId) {
    state.normalWindowsById[String(normalWindowId)] ??= {
      normalWindowId,
      preloadWindow: {
        windowId: null,
      },
      sourceTabs: {},
    };
    return state.normalWindowsById[String(normalWindowId)];
  },
  async ensurePreloadWindow(state, normalWindowId) {
    const runtime = state.normalWindowsById[String(normalWindowId)];
    runtime.preloadWindow.windowId = 110;
    return {
      windowId: 110,
      created: true,
    };
  },
  clearKnownPreloadWindow() {},
  getNormalWindowRuntime(state, windowId) {
    return state.normalWindowsById[String(windowId)] || null;
  },
  async closeHiddenTabsForNormalWindowRuntime(runtime) {
    runtime.closedHiddenTabs = true;
  },
  findNormalWindowRuntimeByPreloadWindowId(state, windowId) {
    for (const [normalWindowId, normalWindowRuntime] of Object.entries(
      state.normalWindowsById || {}
    )) {
      if (normalWindowRuntime.preloadWindow?.windowId === windowId) {
        return {
          normalWindowId,
          normalWindowRuntime,
        };
      }
    }

    return null;
  },
  resetPreloadWindowState(preloadWindow) {
    preloadWindow.windowId = null;
    preloadWindow.hiddenBySystem = false;
  },
  pruneNormalWindowRuntime(state, normalWindowId) {
    const runtime = state.normalWindowsById[String(normalWindowId)];

    if (
      runtime &&
      !runtime.preloadWindow?.windowId &&
      Object.keys(runtime.sourceTabs || {}).length === 0
    ) {
      delete state.normalWindowsById[String(normalWindowId)];
    }
  },
  async queueSideEffect(task) {
    await task();
  },
};
context.globalThis = context;
vm.createContext(context);
for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

await context.ensureWarmPreloadWindowsForActiveNormalWindows();
assert.equal(preloadState.normalWindowsById["10"].preloadWindow.windowId, 110);
assert.equal(preloadState.normalWindowsById["20"], undefined);
assert.equal(preloadState.normalWindowsById["30"], undefined);
assert.equal(savedStates.length, 1);

preloadState.normalWindowsById["10"].preloadWindow.windowId = 99;
await context.handleRemovedWindow(10);
assert.equal(preloadState.normalWindowsById["10"], undefined);
assert.deepEqual(removedWindowIds, [99]);
assert.equal(savedStates.length, 2);

preloadState.normalWindowsById["50"].preloadWindow.windowId = 150;
await context.handlePreloadWindowBoundsChanged({
  id: 150,
  left: 0,
  top: 0,
  width: 100,
  height: 100,
  state: "normal",
});
assert.deepEqual(hiddenMaintains, [
  {
    windowId: 150,
    trigger: "bounds-changed-minimize-fallback",
  },
]);

console.log("preload window lifecycle tests passed");
