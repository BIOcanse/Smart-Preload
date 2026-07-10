import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourcePath = path.join(
  repositoryRoot,
  "extension/background/preload/runtime/window-manager/native-detect.js"
);
let clockCall = 0;
let windows = [];
const context = vm.createContext({
  console,
  Date: { now: () => [0, 1, 2_000][Math.min(clockCall++, 2)] },
  Number,
  Promise,
  Set,
  PRELOAD_WINDOW_SENTINEL_URL: "about:blank#zero-latency-preload-window",
  nativeAppListChromeWindows: async () => windows,
  getNativeAppBrowserFamily: () => "edge",
  normalizePositiveFiniteNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  },
  setTimeout(callback) {
    callback();
    return 1;
  },
});
context.globalThis = context;
vm.runInContext(readFileSync(sourcePath, "utf8"), context, { filename: sourcePath });

windows = [
  createWindow(101, { left: 900, title: "Normal Chrome" }),
  createWindow(102, { left: 1200, title: "Another Chrome" }),
];
const ambiguousCreated = await context.detectCreatedPreloadWindowHwnd(
  new Set([1, 2]),
  createWindow(null, { left: -20_000 })
);
assert.equal(
  ambiguousCreated,
  null,
  "a newly observed HWND without matching bounds must never be selected by position"
);

windows = [
  createWindow(401, { browserKind: "chrome-for-testing" }),
  createWindow(402, { browserKind: "edge" }),
];
assert.deepEqual(
  (await context.getNativeChromeWindows()).map((window) => window.hwnd),
  [402],
  "native HWND discovery must stay inside the current browser family"
);

assert.equal(
  context.pickBestPreloadSentinelWindow([
    createWindow(201, { title: "about:blank#zero-latency-preload-window" }),
    createWindow(202, { title: "about:blank#zero-latency-preload-window" }),
  ]),
  null,
  "multiple sentinel windows are ambiguous without matching bounds"
);
assert.equal(
  context.pickBestPreloadSentinelWindow([
    createWindow(203, { title: "about:blank#zero-latency-preload-window" }),
  ]).hwnd,
  203
);
assert.equal(
  context.pickBestChromeWindowByBounds(
    [createWindow(301), createWindow(302)],
    createWindow(null)
  ),
  null,
  "identical bounds are not sufficient to choose between multiple HWNDs"
);

console.log("preload window native detection tests passed");

function createWindow(hwnd, overrides = {}) {
  return {
    hwnd,
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    visible: true,
    minimized: false,
    toolWindow: false,
    title: "",
    ...overrides,
  };
}
