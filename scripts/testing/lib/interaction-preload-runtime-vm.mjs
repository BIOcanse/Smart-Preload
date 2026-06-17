import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..", "..");

const INTERACTION_PRELOAD_RUNTIME_SCRIPT_SEGMENTS = [
  ["extansion", "background", "shared", "base.js"],
  ["extansion", "background", "preload", "state", "model.js"],
  ["extansion", "background", "preload", "state", "normalize", "entries", "window.js"],
  ["extansion", "background", "preload", "state", "normalize", "entries", "metadata.js"],
  ["extansion", "background", "preload", "state", "normalize", "entries", "scores.js"],
  ["extansion", "background", "preload", "state", "normalize", "entries", "preloads.js"],
  ["extansion", "background", "preload", "state", "normalize", "entries.js"],
  ["extansion", "background", "preload", "state", "normalize", "runtime", "source-tabs.js"],
  ["extansion", "background", "preload", "state", "normalize", "runtime", "snapshots.js"],
  ["extansion", "background", "preload", "state", "normalize", "runtime", "attention.js"],
  ["extansion", "background", "preload", "state", "normalize", "runtime", "windows.js"],
  ["extansion", "background", "preload", "state", "normalize", "runtime.js"],
  ["extansion", "background", "preload", "state", "lookup", "normal-windows.js"],
  ["extansion", "background", "preload", "state", "lookup", "source-tabs.js"],
  ["extansion", "background", "preload", "state", "lookup", "pruning.js"],
  ["extansion", "background", "preload", "incognito-policy", "match.js"],
  ["extansion", "background", "preload", "incognito-policy", "source-window.js"],
  ["extansion", "background", "preload", "incognito-policy", "cleanup.js"],
  ["extansion", "background", "preload", "incognito-policy.js"],
  ["extansion", "background", "preload", "runtime", "diff", "hidden-tabs", "channel.js"],
  ["extansion", "background", "preload", "runtime", "diff", "hidden-tabs", "safety.js"],
  ["extansion", "background", "preload", "runtime", "diff", "hidden-tabs", "entries.js"],
  ["extansion", "background", "preload", "runtime", "diff", "hidden-tabs.js"],
  ["extansion", "background", "preload", "runtime", "diff", "bookmarks.js"],
  ["extansion", "background", "preload", "runtime", "source-tabs", "channels.js"],
  ["extansion", "background", "preload", "runtime", "source-tabs", "hidden-tabs.js"],
  ["extansion", "background", "preload", "runtime", "source-tabs", "speculation.js"],
  ["extansion", "background", "preload", "runtime", "interaction", "context", "source.js"],
  ["extansion", "background", "preload", "runtime", "interaction", "context", "target.js"],
  ["extansion", "background", "preload", "runtime", "interaction", "context", "target-build.js"],
  ["extansion", "background", "preload", "runtime", "interaction", "context.js"],
  ["extansion", "background", "preload", "runtime", "interaction", "cleanup.js"],
  ["extansion", "background", "preload", "runtime", "interaction", "hidden-tabs.js"],
  ["extansion", "background", "preload", "runtime", "interaction", "synthetic.js"],
  ["extansion", "background", "preload", "runtime", "interaction.js"],
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
