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
  ["extansion", "background", "preload", "state", "normalize", "entries", "window.js"],
  ["extansion", "background", "preload", "state", "normalize", "entries", "metadata.js"],
  ["extansion", "background", "preload", "state", "normalize", "entries", "scores.js"],
  ["extansion", "background", "preload", "state", "normalize", "entries", "preloads.js"],
  ["extansion", "background", "preload", "state", "normalize", "entries.js"],
  ["extansion", "background", "preload", "state", "normalize", "runtime", "attention.js"],
  ["extansion", "background", "preload", "state", "normalize", "runtime.js"],
  ["extansion", "background", "preload", "state", "lookup", "normal-windows.js"],
  ["extansion", "background", "preload", "state", "lookup", "source-tabs.js"],
  ["extansion", "background", "preload", "state", "lookup", "pruning.js"],
  ["extansion", "background", "preload", "incognito-policy", "match.js"],
  ["extansion", "background", "preload", "incognito-policy", "source-window.js"],
  ["extansion", "background", "preload", "incognito-policy", "cleanup.js"],
  ["extansion", "background", "preload", "incognito-policy.js"],
  ["extansion", "background", "preload", "runtime", "window-manager", "native-detect.js"],
  ["extansion", "background", "preload", "runtime", "window-manager", "system-hide", "probe.js"],
  ["extansion", "background", "preload", "runtime", "window-manager", "system-hide", "backoff.js"],
  ["extansion", "background", "preload", "runtime", "window-manager", "system-hide", "operations.js"],
  ["extansion", "background", "preload", "runtime", "window-manager", "system-hide.js"],
  ["extansion", "background", "preload", "runtime", "window-manager", "focus.js"],
  ["extansion", "background", "preload", "runtime", "window-manager", "discovery.js"],
  ["extansion", "background", "preload", "runtime", "window-manager", "reuse.js"],
  ["extansion", "background", "preload", "runtime", "window-manager", "creation.js"],
].map((segments) => path.join(repoRoot, ...segments));

const windowsById = new Map([
  [10, { id: 10, type: "normal", incognito: false, focused: false }],
  [11, { id: 11, type: "normal", incognito: true, focused: false }],
]);
const createdWindows = [];
const context = {
  console,
  Date,
  Number,
  setTimeout,
  clearTimeout,
  PRELOAD_WINDOW_SENTINEL_URL: "chrome-extension://test/preload-window.html",
};
context.globalThis = context;
context.ZeroLatencyDebugEvents = {
  events: [],
  record(name, payload) {
    this.events.push({ name, payload });
  },
};
context.ZeroLatencySupport = {
  supportsHiddenTabPreloadRuntime: () => true,
  isSystemLevelWindowHidingUsable: () => false,
  supportsSystemLevelWindowHiding: () => false,
  hasChromeNamespaceMethod(namespace, method) {
    return Boolean(context.chrome?.[namespace]?.[method]);
  },
};
context.currentSettings = {
  preloading: {
    enabled: true,
    excludeIncognitoWindows: false,
  },
};
context.getEffectiveExtensionSettings = () => context.currentSettings;
context.getWindowMaybe = async (windowId) => windowsById.get(windowId) ?? null;
context.getTabMaybe = async () => null;
context.normalizePageUrlForIndex = (url) => String(url || "");
context.chrome = {
  windows: {
    async create(params) {
      const id = 100 + createdWindows.length;
      const createdWindow = {
        id,
        type: "normal",
        incognito: params.incognito === true,
        focused: false,
      };
      createdWindows.push({ params: { ...params }, window: createdWindow });
      windowsById.set(id, createdWindow);
      return createdWindow;
    },
    async update(windowId, patch) {
      const window = windowsById.get(windowId);

      if (window) {
        Object.assign(window, patch);
      }

      return window ?? null;
    },
  },
  tabs: {
    async query() {
      return [];
    },
  },
};

vm.createContext(context);

for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

let preloadState = context.createEmptyPreloadState();
let result = await context.ensurePreloadWindow(preloadState, 10);
assert.equal(result.created, true);
assert.equal(createdWindows.at(-1).params.incognito, undefined);
assert.equal(preloadState.normalWindowsById[10].preloadWindow.windowId, 100);

preloadState = context.createEmptyPreloadState();
result = await context.ensurePreloadWindow(preloadState, 11);
assert.equal(result.created, true);
assert.equal(createdWindows.at(-1).params.incognito, true);
assert.equal(preloadState.normalWindowsById[11].preloadWindow.windowId, 101);

context.currentSettings = {
  preloading: {
    enabled: true,
    excludeIncognitoWindows: true,
  },
};
preloadState = context.createEmptyPreloadState();
result = await context.ensurePreloadWindow(preloadState, 11);
assert.equal(result.created, false);
assert.equal(result.reason, "incognito-excluded");
assert.equal(Object.keys(preloadState.normalWindowsById).length, 0);

console.log("preload incognito policy tests passed");
