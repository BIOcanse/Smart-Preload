import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

const scriptPaths = [
  path.join(
    repoRoot,
    "extension",
    "background",
    "core",
    "state",
    "storage",
    "bootstrap",
    "hydration.js"
  ),
  path.join(
    repoRoot,
    "extension",
    "background",
    "core",
    "state",
    "storage",
    "bootstrap",
    "live-preload.js"
  ),
];

const removedWindowIds = [];
const tabs = [
  { id: 1, windowId: 10, url: "https://source.test/page" },
  { id: 2, windowId: 99, url: "https://target.test/a" },
  { id: 3, windowId: 10, url: "chrome://extensions" },
  { id: 4, windowId: 11, url: "https://www.google.com/search?q=smart+preload" },
];
const liveWindows = [
  {
    id: 10,
    tabs: [
      { id: 1, windowId: 10, url: "https://source.test/page" },
      { id: 3, windowId: 10, url: "chrome://extensions" },
    ],
  },
  {
    id: 11,
    tabs: [{ id: 4, windowId: 11, url: "https://www.google.com/search?q=smart+preload" }],
  },
  {
    id: 99,
    tabs: [{ id: 2, windowId: 99, url: "https://target.test/a" }],
  },
  {
    id: 88,
    tabs: [{ id: 5, windowId: 88, url: "chrome-extension://test/preload-window.html" }],
  },
];

const context = {
  console,
  Math,
  Number,
  Date,
  PRELOAD_WINDOW_SENTINEL_URL: "chrome-extension://test/preload-window.html",
  chrome: {
    tabs: {
      query: async () => tabs,
    },
    windows: {
      getAll: async () => liveWindows,
      remove: async (windowId) => {
        removedWindowIds.push(windowId);
      },
    },
  },
  isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  },
  normalizePositiveInteger(value, fallback = null) {
    const numericValue = Number(value);

    if (!Number.isInteger(numericValue) || numericValue <= 0) {
      return fallback;
    }

    return numericValue;
  },
  normalizeBookmarkPreloadingServiceState(value) {
    return {
      startupGoogleSearchTabId: Number.isInteger(Number(value?.startupGoogleSearchTabId))
        ? Number(value.startupGoogleSearchTabId)
        : null,
      startupGoogleSearchWindowId: Number.isInteger(Number(value?.startupGoogleSearchWindowId))
        ? Number(value.startupGoogleSearchWindowId)
        : null,
    };
  },
  isPreloadWindowId(preloadState, windowId) {
    return Object.values(preloadState.normalWindowsById || {}).some(
      (runtime) => runtime?.preloadWindow?.windowId === windowId
    );
  },
  isGoogleSearchPageForBookmarkPreload(url) {
    return /^https:\/\/www\.google\.com\/search\?/.test(url);
  },
  isTrackableAndAllowedUrl(url) {
    return /^https?:\/\//.test(url);
  },
  buildNodeSeed(url) {
    return {
      nodeId: `node:${url}`,
    };
  },
  normalizePreloadState(preloadState) {
    return JSON.parse(JSON.stringify(preloadState || { normalWindowsById: {} }));
  },
  normalizePageUrlForIndex(url) {
    return typeof url === "string" ? url.split("#")[0] : "";
  },
  resetPreloadWindowState(preloadWindow) {
    preloadWindow.windowId = null;
    preloadWindow.state = "idle";
  },
};
context.globalThis = context;
vm.createContext(context);
for (const scriptPath of scriptPaths) {
  vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
}

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

const preloadState = {
  normalWindowsById: {
    "10": {
      normalWindowId: 10,
      preloadWindow: {
        windowId: 99,
        state: "ready",
      },
      sourceTabs: {
        "1": {
          sourceTabId: 1,
          hiddenTabEntriesByUrl: {
            "https://target.test/a": {
              tabId: 2,
              requestedUrl: "https://target.test/a",
              loadedUrl: "",
            },
            "https://stale.test/": {
              tabId: 404,
              requestedUrl: "https://stale.test/",
              loadedUrl: "",
            },
          },
        },
      },
    },
    "20": {
      normalWindowId: 20,
      preloadWindow: {
        windowId: 120,
        state: "ready",
      },
      sourceTabs: {},
    },
  },
};

const hydratedTabs = await context.hydrateTabStateFromOpenTabsForBackgroundState(preloadState);
assert.deepEqual(Object.keys(hydratedTabs), ["1", "4"]);
assert.equal(hydratedTabs["1"].nodeId, "node:https://source.test/page");
assert.equal(hydratedTabs["4"].nodeId, "node:https://www.google.com/search?q=smart+preload");

const bookmarkState = await context.hydrateBookmarkPreloadingServiceStateForBackgroundState(
  preloadState,
  {
    startupGoogleSearchTabId: 999,
    startupGoogleSearchWindowId: 999,
  }
);
assert.deepEqual(toPlain(bookmarkState), {
  startupGoogleSearchTabId: 4,
  startupGoogleSearchWindowId: 11,
});

const sanitizedPreloadState =
  await context.sanitizeLivePreloadStateForBackgroundState(preloadState);
assert.equal(sanitizedPreloadState.normalWindowsById["20"], undefined);
assert.equal(
  sanitizedPreloadState.normalWindowsById["10"].sourceTabs["1"].hiddenTabEntriesByUrl[
    "https://stale.test/"
  ],
  undefined
);
assert.ok(
  sanitizedPreloadState.normalWindowsById["10"].sourceTabs["1"].hiddenTabEntriesByUrl[
    "https://target.test/a"
  ]
);
assert.deepEqual(removedWindowIds, [88]);

console.log("state storage bootstrap tests passed");
