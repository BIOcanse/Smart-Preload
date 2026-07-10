import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const scriptPaths = [
  ["extension", "background", "shared", "base.js"],
  ["extension", "background", "preload", "state", "model.js"],
  ["extension", "background", "preload", "state", "normalize", "entries", "window.js"],
  ["extension", "background", "preload", "state", "normalize", "entries", "metadata.js"],
  ["extension", "background", "preload", "state", "normalize", "entries", "scores.js"],
  ["extension", "background", "preload", "state", "normalize", "entries", "preloads.js"],
  ["extension", "background", "preload", "state", "normalize", "entries.js"],
  ["extension", "background", "preload", "state", "normalize", "runtime", "attention.js"],
  ["extension", "background", "preload", "state", "normalize", "runtime.js"],
  ["extension", "background", "preload", "state", "lookup", "normal-windows.js"],
  ["extension", "background", "preload", "state", "lookup", "source-tabs.js"],
  ["extension", "background", "preload", "state", "lookup", "pruning.js"],
  ["extension", "background", "preload", "incognito-policy", "match.js"],
  ["extension", "background", "preload", "incognito-policy", "source-window.js"],
  ["extension", "background", "preload", "incognito-policy", "cleanup.js"],
  ["extension", "background", "preload", "incognito-policy.js"],
  ["extension", "background", "preload", "runtime", "window-manager", "native-detect.js"],
  ["extension", "background", "preload", "runtime", "window-manager", "system-hide", "probe.js"],
  ["extension", "background", "preload", "runtime", "window-manager", "system-hide", "backoff.js"],
  ["extension", "background", "preload", "runtime", "window-manager", "system-hide", "operations.js"],
  ["extension", "background", "preload", "runtime", "window-manager", "system-hide.js"],
  ["extension", "background", "preload", "runtime", "window-manager", "focus.js"],
  ["extension", "background", "preload", "runtime", "window-manager", "discovery.js"],
  ["extension", "background", "preload", "runtime", "window-manager", "reuse.js"],
  ["extension", "background", "preload", "runtime", "window-manager", "creation", "guards.js"],
  ["extension", "background", "preload", "runtime", "window-manager", "creation", "create.js"],
  ["extension", "background", "preload", "runtime", "window-manager", "creation.js"],
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
