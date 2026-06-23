import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..", "..");

const PRELOAD_SCHEDULER_SCRIPT_SEGMENTS = [
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
  ["extension", "shared", "settings", "migrations.js"],
  ["extension", "shared", "settings", "normalize", "appearance-layout.js"],
  ["extension", "shared", "settings", "normalize", "preload.js"],
  ["extension", "shared", "settings", "normalize", "scheduler.js"],
  ["extension", "shared", "settings", "normalize.js"],
  ["extension", "shared", "settings", "storage.js"],
  ["extension", "shared", "settings.js"],
  ["extension", "background", "shared", "base.js"],
  ["extension", "background", "tracking", "url", "google.js"],
  ["extension", "background", "tracking", "url", "network.js"],
  ["extension", "background", "tracking", "url", "model.js"],
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
  ["extension", "background", "preload", "proxy-skip-policy.js"],
  ["extension", "background", "preload", "native-only-policy", "constants.js"],
  ["extension", "background", "preload", "native-only-policy", "mode.js"],
  ["extension", "background", "preload", "native-only-policy", "cleanup.js"],
  ["extension", "background", "preload", "native-only-policy", "warning-storage.js"],
  ["extension", "background", "preload", "native-only-policy", "app-warning.js"],
  ["extension", "background", "preload", "native-only-policy", "real-preload-recommendation.js"],
  ["extension", "background", "preload", "native-only-policy.js"],
  ["extension", "background", "preload", "scoring", "ai-interest", "context.js"],
  ["extension", "background", "preload", "scoring", "ai-interest", "readiness.js"],
  ["extension", "background", "preload", "scoring", "ai-interest", "diagnostics.js"],
  ["extension", "background", "preload", "scoring", "ai-interest", "cache.js"],
  ["extension", "background", "preload", "scoring", "ai-interest", "inference.js"],
  ["extension", "background", "preload", "scoring", "ai-interest.js"],
  ["extension", "background", "preload", "scoring", "constants.js"],
  ["extension", "background", "preload", "scoring", "multipliers.js"],
  ["extension", "background", "preload", "scoring", "ai-keywords.js"],
  ["extension", "background", "preload", "scoring", "pool.js"],
  ["extension", "background", "preload", "scoring.js"],
  ["extension", "background", "preload", "prediction", "strategy", "flags.js"],
  ["extension", "background", "preload", "prediction", "strategy", "scenario.js"],
  ["extension", "background", "preload", "prediction", "strategy", "same-origin.js"],
  ["extension", "background", "preload", "prediction", "strategy", "cross-site-current-tab.js"],
  ["extension", "background", "preload", "prediction", "strategy", "cross-site-new-tab.js"],
  ["extension", "background", "preload", "prediction", "strategy", "resolver.js"],
  ["extension", "background", "preload", "prediction", "strategy", "signals.js"],
  ["extension", "background", "preload", "prediction", "strategy", "selection.js"],
  ["extension", "background", "preload", "prediction", "strategy-router.js"],
  ["extension", "background", "preload", "scheduler", "allocation", "constants.js"],
  ["extension", "background", "preload", "scheduler", "allocation", "cap.js"],
  ["extension", "background", "preload", "scheduler", "allocation", "slot-input.js"],
  ["extension", "background", "preload", "scheduler", "allocation", "slot-state.js"],
  ["extension", "background", "preload", "scheduler", "allocation", "slots.js"],
  ["extension", "background", "preload", "scheduler", "allocation.js"],
  ["extension", "background", "preload", "scheduler", "attention", "options.js"],
  ["extension", "background", "preload", "scheduler", "attention", "pool.js"],
  ["extension", "background", "preload", "scheduler", "attention", "activity.js"],
  ["extension", "background", "preload", "scheduler", "attention", "pending.js"],
  ["extension", "background", "preload", "scheduler", "attention", "cursor.js"],
  ["extension", "background", "preload", "scheduler", "attention", "reschedule.js"],
  ["extension", "background", "preload", "scheduler", "attention", "observation", "timing.js"],
  ["extension", "background", "preload", "scheduler", "attention", "observation", "commit.js"],
  ["extension", "background", "preload", "scheduler", "attention", "observation.js"],
  ["extension", "background", "preload", "scheduler", "attention", "runtime", "source.js"],
  ["extension", "background", "preload", "scheduler", "attention", "runtime", "mutation.js"],
  ["extension", "background", "preload", "scheduler", "attention", "runtime.js"],
  ["extension", "background", "preload", "scheduler", "attention.js"],
  ["extension", "background", "preload", "scheduler", "selection-targets", "priority.js"],
  ["extension", "background", "preload", "scheduler", "selection-targets", "build.js"],
  ["extension", "background", "preload", "scheduler", "selection-targets", "group.js"],
  ["extension", "background", "preload", "scheduler", "selection-targets", "bookmarks.js"],
  ["extension", "background", "preload", "scheduler", "selection-targets.js"],
  ["extension", "background", "preload", "scheduler", "snapshots.js"],
  ["extension", "background", "preload", "scheduler", "group-allocation.js"],
  ["extension", "background", "preload", "scheduler", "schedule", "fallback.js"],
  ["extension", "background", "preload", "scheduler", "schedule", "rebuild.js"],
  ["extension", "background", "preload", "scheduler", "schedule", "logging.js"],
  ["extension", "background", "preload", "scheduler", "schedule.js"],
  ["extension", "background", "preload", "scheduler", "runtime-sync.js"],
  ["extension", "background", "preload", "scheduler", "selections", "wide.js"],
  ["extension", "background", "preload", "scheduler", "selections", "apply.js"],
  ["extension", "background", "preload", "scheduler", "selections", "reschedule.js"],
  ["extension", "background", "preload", "scheduler", "selections.js"],
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
