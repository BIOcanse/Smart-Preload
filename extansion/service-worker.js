importScripts(
  "shared/ai-model-catalog.js",
  "shared/lmstudio.js",
  "shared/settings.js",
  "background/shared/base.js",
  "background/shared/native-app/wake.js",
  "background/shared/native-app/request/common.js",
  "background/shared/native-app/request/transport.js",
  "background/shared/native-app/request/registration.js",
  "background/shared/native-app/request/heartbeat-activity.js",
  "background/shared/native-app/request/heartbeat.js",
  "background/shared/native-app/request.js",
  "background/shared/native-app/health.js",
  "background/shared/native-app/windows.js",
  "background/shared/native-app.js",
  "background/diagnostics/logger.js",
  "background/shared/support/platform.js",
  "background/shared/support/features.js",
  "background/shared/support/usability.js",
  "background/shared/support.js",
  "background/ai/keywords.js",
  "background/ai/providers/common.js",
  "background/ai/providers/request.js",
  "background/ai/providers/response.js",
  "background/ai/providers/lmstudio-lifecycle.js",
  "background/ai/providers.js",
  "background/tracking/url/model.js",
  "background/tracking/graph/model/schema.js",
  "background/tracking/graph/model/normalize/learning.js",
  "background/tracking/graph/model/normalize/messages.js",
  "background/tracking/graph/model/normalize/startup.js",
  "background/tracking/graph/model/normalize/graph.js",
  "background/tracking/graph/model/normalize.js",
  "background/tracking/graph/model/edge-stats.js",
  "background/tracking/graph/model.js",
  "background/tracking/graph/indexes/link-behavior.js",
  "background/tracking/graph/indexes/keywords.js",
  "background/tracking/graph/indexes/transitions/buckets.js",
  "background/tracking/graph/indexes/transitions/query/window.js",
  "background/tracking/graph/indexes/transitions/query/source.js",
  "background/tracking/graph/indexes/transitions/query/pages.js",
  "background/tracking/graph/indexes/transitions/query.js",
  "background/tracking/graph/indexes/transitions/messages.js",
  "background/tracking/graph/indexes/transitions.js",
  "background/tracking/graph/indexes.js",
  "background/tracking/engine/wasm/io.js",
  "background/tracking/engine/wasm/bridge.js",
  "background/tracking/engine/wasm/load.js",
  "background/tracking/engine/wasm.js",
  "background/tracking/engine/query-fallback/transitions.js",
  "background/tracking/engine/query-fallback/learning.js",
  "background/tracking/engine/query-fallback.js",
  "background/tracking/engine/api.js",
  "background/preload/state/model.js",
  "background/preload/state/normalize/entries.js",
  "background/preload/state/normalize/runtime.js",
  "background/preload/state/normalize/legacy.js",
  "background/preload/state/normalize.js",
  "background/preload/state/lookup/normal-windows.js",
  "background/preload/state/lookup/source-tabs.js",
  "background/preload/state/lookup/membership.js",
  "background/preload/state/lookup/pruning.js",
  "background/preload/state/lookup.js",
  "background/preload/state/view.js",
  "background/preload/state.js",
  "background/preload/incognito-policy.js",
  "background/preload/proxy-skip-policy.js",
  "background/preload/native-only-policy.js",
  "background/tracking/graph/events/current-page.js",
  "background/tracking/graph/events/transitions.js",
  "background/tracking/graph/events/learning.js",
  "background/tracking/graph/events/tabs.js",
  "background/tracking/graph/events.js",
  "background/tracking/engine.js",
  "background/tracking/view.js",
  "background/tracking/history-deletion.js",
  "background/core/state.js",
  "background/core/debug/events.js",
  "background/core/messages/debug.js",
  "background/core/messages/settings.js",
  "background/core/messages/service-control.js",
  "background/core/messages/native-app-update.js",
  "background/core/messages.js",
  "background/core/state/config.js",
  "background/core/state/storage/normalize.js",
  "background/core/state/storage/tracking.js",
  "background/core/state/storage/preload.js",
  "background/core/state/storage/service.js",
  "background/core/state/storage/bootstrap.js",
  "background/core/state/storage.js",
  "background/core/state/container.js",
  "background/core/state/bindings.js",
  "background/shared/chrome.js",
  "background/tracking/index.js",
  "background/preload/scoring.js",
  "background/preload/scheduler/allocation.js",
  "background/preload/scheduler/attention.js",
  "background/preload/scheduler/selections.js",
  "background/preload/rules.js",
  "background/preload/prediction/metrics.js",
  "background/preload/prediction/bookmarks.js",
  "background/preload/prediction/candidate-pool.js",
  "background/preload/prediction/site-selection.js",
  "background/preload/prediction/strategy/flags.js",
  "background/preload/prediction/strategy/scenario.js",
  "background/preload/prediction/strategy/same-origin.js",
  "background/preload/prediction/strategy/cross-site-current-tab.js",
  "background/preload/prediction/strategy/cross-site-new-tab.js",
  "background/preload/prediction/strategy-router.js",
  "background/preload/prediction.js",
  "background/preload/runtime/context-registry.js",
  "background/preload/runtime/window-manager/creation.js",
  "background/preload/runtime/window-manager/hiding.js",
  "background/preload/runtime/window-manager/priming.js",
  "background/preload/runtime/window-manager.js",
  "background/preload/runtime/policy/cleanup.js",
  "background/preload/runtime/policy/repair.js",
  "background/preload/runtime/policy/watchdog.js",
  "background/preload/runtime/window-policy.js",
  "background/preload/runtime/windows.js",
  "background/preload/runtime/candidate-registration/context.js",
  "background/preload/runtime/candidate-registration/tracking.js",
  "background/preload/runtime/candidate-registration/diagnostics.js",
  "background/preload/runtime/candidate-registration/apply-selection.js",
  "background/preload/runtime/candidate-registration/response.js",
  "background/preload/runtime/candidate-registration.js",
  "background/preload/runtime/source-tabs/ownership.js",
  "background/preload/runtime/source-tabs/hidden-tabs.js",
  "background/preload/runtime/source-tabs/speculation.js",
  "background/preload/runtime/source-tabs.js",
  "background/preload/runtime/interaction.js",
  "background/preload/runtime/sync.js",
  "background/preload/runtime/activation/tracking.js",
  "background/preload/runtime/activation/request.js",
  "background/preload/runtime/activation/resolution.js",
  "background/preload/runtime/activation/promotion.js",
  "background/preload/runtime/activation/cleanup.js",
  "background/preload/runtime/activation/flow.js",
  "background/preload/runtime/activation.js",
  "background/preload/runtime/lifecycle/candidates.js",
  "background/preload/runtime/lifecycle/tabs.js",
  "background/preload/runtime/lifecycle/windows.js",
  "background/preload/runtime/lifecycle/reset.js",
  "background/preload/runtime/lifecycle.js",
  "background/preload/runtime/manager.js",
  "background/learning/link-behavior.js",
  "background/learning/foreground-pages.js",
  "background/learning/index.js",
  "background/navigation/manager.js",
  "background/intercept/messages.js",
  "background/intercept/navigation.js",
  "background/intercept/runtime.js",
  "background/judge/messages.js",
  "background/judge/navigation.js",
  "background/judge/runtime.js",
  "background/actions/messages.js",
  "background/actions/navigation.js",
  "background/actions/runtime.js",
  "background/core/router/messages.js",
  "background/core/router/navigation.js",
  "background/core/router/runtime.js",
  "background/core/router.js"
);

const settingsApi = globalThis.ZeroLatencySettings;
const backgroundState = new globalThis.ZeroLatencyBackgroundState({
  settingsApi,
  chromeStorage: chrome.storage.local,
});
globalThis.backgroundState = backgroundState;

const SETTINGS_STORAGE_KEY = backgroundState.keys.SETTINGS_STORAGE_KEY;
const GRAPH_KEY = backgroundState.keys.GRAPH_KEY;
const TAB_STATE_KEY = backgroundState.keys.TAB_STATE_KEY;
const PENDING_SOURCE_KEY = backgroundState.keys.PENDING_SOURCE_KEY;
const PRELOAD_STATE_KEY = backgroundState.keys.PRELOAD_STATE_KEY;
const SERVICE_STATE_KEY = backgroundState.keys.SERVICE_STATE_KEY;
const MAX_DEBUG_TRANSITIONS = backgroundState.constants.MAX_DEBUG_TRANSITIONS;
const STARTUP_SYNC_MESSAGE_WINDOW =
  backgroundState.constants.STARTUP_SYNC_MESSAGE_WINDOW;
const WASM_ENGINE_PATH = backgroundState.constants.WASM_ENGINE_PATH;
const PRELOAD_WINDOW_WATCHDOG_ALARM =
  backgroundState.constants.PRELOAD_WINDOW_WATCHDOG_ALARM;
const PRELOAD_WINDOW_CLEANUP_ALARM =
  backgroundState.constants.PRELOAD_WINDOW_CLEANUP_ALARM;
const PRELOAD_WINDOW_SENTINEL_URL =
  backgroundState.constants.PRELOAD_WINDOW_SENTINEL_URL;
const BUCKET_PRIMARY_CHARSET = backgroundState.constants.BUCKET_PRIMARY_CHARSET;
const BUCKET_SECONDARY_BLANK_INDEX =
  backgroundState.constants.BUCKET_SECONDARY_BLANK_INDEX;
const OUTBOUND_BUCKET_COUNT = backgroundState.constants.OUTBOUND_BUCKET_COUNT;
const TRANSITION_WINDOW_KEYS = backgroundState.constants.TRANSITION_WINDOW_KEYS;

const mainRouter = new globalThis.ZeroLatencyMainRouter();

void queueMutation(async () => {
  await mainRouter.bootstrap();
});

chrome.runtime.onInstalled.addListener(() => {
  queueMutation(async () => {
    await mainRouter.handleInstalled();
  });
});

chrome.runtime.onStartup.addListener(() => {
  queueMutation(async () => {
    await mainRouter.handleStartup();
  });
});

chrome.runtime.onSuspend?.addListener?.(() => {
  void globalThis.ZeroLatencyDiagnostics?.flushNow?.({ finalFlush: true });
  void globalThis.ZeroLatencyAiProviders?.unloadConfiguredLmStudioModel?.(
    getEffectiveExtensionSettings(),
    "service-worker-suspend"
  );
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  queueMutation(async () => {
    await mainRouter.handleStorageChanged(changes, areaName);
  });
});

chrome.webNavigation.onCommitted.addListener((details) => {
  queueMutation(async () => {
    await mainRouter.handleCommitted(details);
  });
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  queueMutation(async () => {
    await mainRouter.handleHistoryStateUpdated(details);
  });
});

chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
  queueMutation(async () => {
    await mainRouter.handleCreatedNavigationTarget(details);
  });
});

chrome.webNavigation.onTabReplaced.addListener((details) => {
  queueMutation(async () => {
    await mainRouter.handleTabReplaced(details);
  });
});

chrome.tabs.onCreated.addListener((tab) => {
  queueMutation(async () => {
    await mainRouter.handleTabCreated(tab);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  queueMutation(async () => {
    await mainRouter.handleTabRemoved(tabId);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  queueMutation(async () => {
    await mainRouter.handleTabUpdated(tabId, changeInfo, tab);
  });
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  queueMutation(async () => {
    await mainRouter.handleTabActivated(activeInfo);
  });
});

chrome.windows.onRemoved.addListener((windowId) => {
  queueMutation(async () => {
    await mainRouter.handleWindowRemoved(windowId);
  });
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  queueMutation(async () => {
    await mainRouter.handleWindowFocused(windowId);
  });
});

chrome.windows.onBoundsChanged.addListener((window) => {
  queueMutation(async () => {
    await mainRouter.handleWindowBoundsChanged(window);
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  queueMutation(async () => {
    await mainRouter.handleAlarm(alarm);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const task = mainRouter.createMessageTask(message, sender);

  if (!task) {
    return false;
  }

  return respondWithTask(sendResponse, task);
});

function respondWithTask(sendResponse, task) {
  const executeTask = typeof task === "function" ? task : task?.task;

  if (task?.queueMode === "direct") {
    void executeMessageTask(sendResponse, executeTask);
    return true;
  }

  const queue =
    task?.queueMode === "side-effect" ? queueSideEffect : queueMutation;

  queue(async () => {
    await executeMessageTask(sendResponse, executeTask);
  });

  return true;
}

async function executeMessageTask(sendResponse, executeTask) {
  try {
    sendResponse(await executeTask());
  } catch (error) {
    console.error("Zero-Latency message handler failed.", error);
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
