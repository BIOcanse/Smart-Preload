import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..", "..");

const PRELOAD_SCHEDULER_SCRIPT_SEGMENTS = [
  ["extansion", "shared", "settings", "utils.js"],
  ["extansion", "shared", "settings", "schema", "localize.js"],
  ["extansion", "shared", "settings", "schema", "constants.js"],
  ["extansion", "shared", "settings", "schema", "options.js"],
  ["extansion", "shared", "settings", "schema", "rule-cards.js"],
  ["extansion", "shared", "settings", "schema.js"],
  ["extansion", "shared", "settings", "defaults.js"],
  ["extansion", "shared", "settings", "rules.js"],
  ["extansion", "shared", "settings", "proxy-skip.js"],
  ["extansion", "shared", "settings", "ai.js"],
  ["extansion", "shared", "settings", "effective.js"],
  ["extansion", "shared", "settings", "normalize", "appearance-layout.js"],
  ["extansion", "shared", "settings", "normalize", "preload.js"],
  ["extansion", "shared", "settings", "normalize", "scheduler.js"],
  ["extansion", "shared", "settings", "normalize.js"],
  ["extansion", "shared", "settings", "storage.js"],
  ["extansion", "shared", "settings.js"],
  ["extansion", "background", "shared", "base.js"],
  ["extansion", "background", "tracking", "url", "google.js"],
  ["extansion", "background", "tracking", "url", "network.js"],
  ["extansion", "background", "tracking", "url", "model.js"],
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
  ["extansion", "background", "preload", "proxy-skip-policy.js"],
  ["extansion", "background", "preload", "native-only-policy", "constants.js"],
  ["extansion", "background", "preload", "native-only-policy", "mode.js"],
  ["extansion", "background", "preload", "native-only-policy", "cleanup.js"],
  ["extansion", "background", "preload", "native-only-policy", "warning-storage.js"],
  ["extansion", "background", "preload", "native-only-policy", "app-warning.js"],
  ["extansion", "background", "preload", "native-only-policy", "real-preload-recommendation.js"],
  ["extansion", "background", "preload", "native-only-policy.js"],
  ["extansion", "background", "preload", "scoring", "ai-interest", "context.js"],
  ["extansion", "background", "preload", "scoring", "ai-interest", "readiness.js"],
  ["extansion", "background", "preload", "scoring", "ai-interest", "diagnostics.js"],
  ["extansion", "background", "preload", "scoring", "ai-interest", "cache.js"],
  ["extansion", "background", "preload", "scoring", "ai-interest", "inference.js"],
  ["extansion", "background", "preload", "scoring", "ai-interest.js"],
  ["extansion", "background", "preload", "scoring", "constants.js"],
  ["extansion", "background", "preload", "scoring", "multipliers.js"],
  ["extansion", "background", "preload", "scoring", "ai-keywords.js"],
  ["extansion", "background", "preload", "scoring", "pool.js"],
  ["extansion", "background", "preload", "scoring.js"],
  ["extansion", "background", "preload", "prediction", "strategy", "flags.js"],
  ["extansion", "background", "preload", "prediction", "strategy", "scenario.js"],
  ["extansion", "background", "preload", "prediction", "strategy", "same-origin.js"],
  ["extansion", "background", "preload", "prediction", "strategy", "cross-site-current-tab.js"],
  ["extansion", "background", "preload", "prediction", "strategy", "cross-site-new-tab.js"],
  ["extansion", "background", "preload", "prediction", "strategy", "resolver.js"],
  ["extansion", "background", "preload", "prediction", "strategy", "signals.js"],
  ["extansion", "background", "preload", "prediction", "strategy", "selection.js"],
  ["extansion", "background", "preload", "prediction", "strategy-router.js"],
  ["extansion", "background", "preload", "scheduler", "allocation", "constants.js"],
  ["extansion", "background", "preload", "scheduler", "allocation", "cap.js"],
  ["extansion", "background", "preload", "scheduler", "allocation", "slot-input.js"],
  ["extansion", "background", "preload", "scheduler", "allocation", "slot-state.js"],
  ["extansion", "background", "preload", "scheduler", "allocation", "slots.js"],
  ["extansion", "background", "preload", "scheduler", "allocation.js"],
  ["extansion", "background", "preload", "scheduler", "attention", "options.js"],
  ["extansion", "background", "preload", "scheduler", "attention", "pool.js"],
  ["extansion", "background", "preload", "scheduler", "attention", "activity.js"],
  ["extansion", "background", "preload", "scheduler", "attention", "pending.js"],
  ["extansion", "background", "preload", "scheduler", "attention", "cursor.js"],
  ["extansion", "background", "preload", "scheduler", "attention", "reschedule.js"],
  ["extansion", "background", "preload", "scheduler", "attention", "observation", "timing.js"],
  ["extansion", "background", "preload", "scheduler", "attention", "observation", "commit.js"],
  ["extansion", "background", "preload", "scheduler", "attention", "observation.js"],
  ["extansion", "background", "preload", "scheduler", "attention", "runtime", "source.js"],
  ["extansion", "background", "preload", "scheduler", "attention", "runtime", "mutation.js"],
  ["extansion", "background", "preload", "scheduler", "attention", "runtime.js"],
  ["extansion", "background", "preload", "scheduler", "attention.js"],
  ["extansion", "background", "preload", "scheduler", "selection-targets", "priority.js"],
  ["extansion", "background", "preload", "scheduler", "selection-targets", "build.js"],
  ["extansion", "background", "preload", "scheduler", "selection-targets", "group.js"],
  ["extansion", "background", "preload", "scheduler", "selection-targets", "bookmarks.js"],
  ["extansion", "background", "preload", "scheduler", "selection-targets.js"],
  ["extansion", "background", "preload", "scheduler", "snapshots.js"],
  ["extansion", "background", "preload", "scheduler", "group-allocation.js"],
  ["extansion", "background", "preload", "scheduler", "schedule", "fallback.js"],
  ["extansion", "background", "preload", "scheduler", "schedule", "rebuild.js"],
  ["extansion", "background", "preload", "scheduler", "schedule", "logging.js"],
  ["extansion", "background", "preload", "scheduler", "schedule.js"],
  ["extansion", "background", "preload", "scheduler", "runtime-sync.js"],
  ["extansion", "background", "preload", "scheduler", "selections", "wide.js"],
  ["extansion", "background", "preload", "scheduler", "selections", "apply.js"],
  ["extansion", "background", "preload", "scheduler", "selections", "reschedule.js"],
  ["extansion", "background", "preload", "scheduler", "selections.js"],
];

export function loadPreloadSchedulerVmContext(overrides = {}) {
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
    ...overrides,
  };

  context.globalThis = context;
  context.ZeroLatencySupport = {
    supportsHiddenTabPreloadRuntime: () => true,
    ...(overrides.ZeroLatencySupport || {}),
  };
  vm.createContext(context);

  for (const scriptPath of buildPreloadSchedulerScriptPaths()) {
    vm.runInContext(readFileSync(scriptPath, "utf8"), context, { filename: scriptPath });
  }

  context.settingsApi = context.ZeroLatencySettings;
  return context;
}

export function buildPreloadSchedulerScriptPaths() {
  return PRELOAD_SCHEDULER_SCRIPT_SEGMENTS.map((segments) => path.join(repoRoot, ...segments));
}
