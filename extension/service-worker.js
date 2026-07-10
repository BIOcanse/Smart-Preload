importScripts("service-worker-scripts.js");
importScripts(...globalThis.ZERO_LATENCY_SERVICE_WORKER_SCRIPTS);

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
  void globalThis.flushTrackingState?.();
  void globalThis.ZeroLatencyBackgroundTaskPersistence?.persist?.(
    globalThis.ZeroLatencyBackgroundTaskStore
  );
  void globalThis.ZeroLatencyPreloadSchedulerAttention?.flushPendingAttention?.(
    "service-worker-suspend"
  );
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
  if (
    globalThis.ZeroLatencyNativeAppHeartbeat?.isAlarm?.(alarm?.name) === true ||
    globalThis.ZeroLatencyNativeAppHeartbeat?.isWakeRetryAlarm?.(alarm?.name) === true
  ) {
    void mainRouter.handleAlarm(alarm).catch((error) => {
      console.error("Smart Preload native lifecycle alarm failed.", error);
    });
    return;
  }

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

  const queueTask = () => executeMessageTaskResult(executeTask);
  let queuedResult;

  if (task?.queueMode === "interaction") {
    queuedResult = queueInteraction(queueTask);
  } else if (task?.queueMode === "candidate") {
    queuedResult = queueCandidate(task.queueKey, queueTask);
  } else if (task?.queueMode === "attention") {
    queuedResult = queueAttention(task.queueKey, queueTask);
  } else if (task?.queueMode === "ai") {
    queuedResult = queueAi(task.queueKey, queueTask);
  } else {
    const queue = task?.queueMode === "side-effect" ? queueSideEffect : queueMutation;
    queuedResult = queue(queueTask);
  }

  void queuedResult.then(sendResponse);

  return true;
}

async function executeMessageTask(sendResponse, executeTask) {
  sendResponse(await executeMessageTaskResult(executeTask));
}

async function executeMessageTaskResult(executeTask) {
  try {
    return await executeTask();
  } catch (error) {
    console.error("Zero-Latency message handler failed.", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
