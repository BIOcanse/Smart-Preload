import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..", "..");

const INTERACTION_PRELOAD_RUNTIME_SCRIPT_SEGMENTS = [
  ["extension", "background", "shared", "base.js"],
  ["extension", "background", "preload", "state", "model.js"],
  ["extension", "background", "preload", "state", "normalize", "entries", "window.js"],
  ["extension", "background", "preload", "state", "normalize", "entries", "metadata.js"],
  ["extension", "background", "preload", "state", "normalize", "entries", "scores.js"],
  ["extension", "background", "preload", "state", "normalize", "entries", "preloads.js"],
  ["extension", "background", "preload", "state", "normalize", "entries.js"],
  ["extension", "background", "preload", "state", "normalize", "runtime", "source-tabs.js"],
  ["extension", "background", "preload", "state", "normalize", "runtime", "snapshots.js"],
  ["extension", "background", "preload", "state", "normalize", "runtime", "attention.js"],
  ["extension", "background", "preload", "state", "normalize", "runtime", "windows.js"],
  ["extension", "background", "preload", "state", "normalize", "runtime.js"],
  ["extension", "background", "preload", "state", "lookup", "normal-windows.js"],
  ["extension", "background", "preload", "state", "lookup", "source-tabs.js"],
  ["extension", "background", "preload", "state", "lookup", "pruning.js"],
  ["extension", "background", "preload", "incognito-policy", "match.js"],
  ["extension", "background", "preload", "incognito-policy", "source-window.js"],
  ["extension", "background", "preload", "incognito-policy", "cleanup.js"],
  ["extension", "background", "preload", "incognito-policy.js"],
  ["extension", "background", "preload", "runtime", "diff", "hidden-tabs", "channel.js"],
  ["extension", "background", "preload", "runtime", "diff", "hidden-tabs", "safety.js"],
  ["extension", "background", "preload", "runtime", "diff", "hidden-tabs", "entries.js"],
  ["extension", "background", "preload", "runtime", "diff", "hidden-tabs.js"],
  ["extension", "background", "preload", "runtime", "diff", "bookmarks.js"],
  ["extension", "background", "preload", "runtime", "source-tabs", "channels.js"],
  ["extension", "background", "preload", "runtime", "source-tabs", "hidden-tabs.js"],
  ["extension", "background", "preload", "runtime", "source-tabs", "speculation.js"],
  ["extension", "background", "preload", "runtime", "interaction", "context", "source.js"],
  ["extension", "background", "preload", "runtime", "interaction", "context", "target.js"],
  ["extension", "background", "preload", "runtime", "interaction", "context", "target-build.js"],
  ["extension", "background", "preload", "runtime", "interaction", "context.js"],
  ["extension", "background", "preload", "runtime", "interaction", "cleanup.js"],
  ["extension", "background", "preload", "runtime", "interaction", "hidden-tabs.js"],
  ["extension", "background", "preload", "runtime", "interaction", "synthetic.js"],
  ["extension", "background", "preload", "runtime", "interaction.js"],
];

export function loadInteractionPreloadRuntimeVmContext(overrides = {}) {
  const context = {
    console,
    Date,
    Number,
    URL,
    setTimeout,
    ...overrides,
  };

  context.globalThis = context;
  context.ZeroLatencyDebugEvents = overrides.ZeroLatencyDebugEvents || {
    events: [],
    record(name, payload) {
      this.events.push({ name, payload });
    },
  };
  context.currentSettings = {
    preloading: {
      enabled: true,
      interactionPreloadEnabled: true,
      excludeIncognitoWindows: true,
    },
    ...(overrides.currentSettings || {}),
  };
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
  context.isExcludedTrackingPage = () => false;
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
  context.isSameOriginUrl =
    (leftUrl, rightUrl) => new URL(leftUrl).origin === new URL(rightUrl).origin;
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

  for (const scriptPath of buildInteractionPreloadRuntimeScriptPaths()) {
    vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
  }

  return context;
}

export function buildInteractionPreloadRuntimeScriptPaths() {
  return INTERACTION_PRELOAD_RUNTIME_SCRIPT_SEGMENTS.map((segments) =>
    path.join(repoRoot, ...segments)
  );
}
