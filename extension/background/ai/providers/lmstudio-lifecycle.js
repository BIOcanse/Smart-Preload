(function () {
  const namespace = (globalThis.ZeroLatencyAiProviderModules =
    globalThis.ZeroLatencyAiProviderModules || {});
  const { isLmStudioProvider } = namespace;
  const LM_STUDIO_MODEL_POLL_TIMEOUT_MS = 120_000;
  const LM_STUDIO_LIFECYCLE_ALARM = "ai-lmstudio-lifecycle-watchdog";
  const LM_STUDIO_LIFECYCLE_INTERVAL_SECONDS = 1;
  const NON_CHROME_FULLSCREEN_UNLOAD_AFTER_MS = 5_000;
  const ACTIVITY_QUERY_FAILURE_UNLOAD_THRESHOLD = 3;
  let lmStudioLoadState = {
    modelId: "",
    promise: null,
  };
  let nonChromeFullscreenSinceAt = null;
  let activityQueryFailureCount = 0;

  async function ensureLmStudioModelReady(modelId) {
    const lmStudio = globalThis.ZeroLatencyLmStudio;
    const normalizedModelId = typeof modelId === "string" ? modelId.trim() : "";

    if (!normalizedModelId || typeof lmStudio?.getModelStatus !== "function") {
      return false;
    }

    const status = await lmStudio.getModelStatus(normalizedModelId).catch(() => null);

    if (status?.loaded) {
      return true;
    }

    startLmStudioModelLoad(normalizedModelId);
    return false;
  }

  function startLmStudioModelLoad(modelId) {
    const lmStudio = globalThis.ZeroLatencyLmStudio;

    if (typeof lmStudio?.loadModel !== "function") {
      return null;
    }

    if (lmStudioLoadState.modelId === modelId && lmStudioLoadState.promise) {
      return lmStudioLoadState.promise;
    }

    lmStudioLoadState = {
      modelId,
      promise: (async () => {
        await lmStudio.loadModel(modelId, { timeoutMs: LM_STUDIO_MODEL_POLL_TIMEOUT_MS });
        return await lmStudio.waitForModelLoaded(modelId, {
          timeoutMs: LM_STUDIO_MODEL_POLL_TIMEOUT_MS,
        });
      })()
        .catch((error) => {
          globalThis.ZeroLatencyDebugEvents?.record?.("ai.lmstudio.load.error", {
            modelId,
            error: String(error?.message || error),
          });
          return { ok: false, error: String(error?.message || error) };
        })
        .finally(() => {
          if (lmStudioLoadState.modelId === modelId) {
            lmStudioLoadState = {
              modelId: "",
              promise: null,
            };
          }
        }),
    };

    return lmStudioLoadState.promise;
  }

  async function unloadConfiguredLmStudioModel(settings, reason = "runtime-inactive") {
    const lmStudio = globalThis.ZeroLatencyLmStudio;
    const aiPrediction = settings?.preloading?.aiPrediction ?? {};
    const modelId = typeof aiPrediction.modelId === "string" ? aiPrediction.modelId.trim() : "";

    if (
      !isLmStudioProvider(aiPrediction.providerId) ||
      !modelId ||
      typeof lmStudio?.unloadModel !== "function"
    ) {
      return { ok: true, skipped: true, reason: "not-lmstudio" };
    }

    try {
      const result = await lmStudio.unloadModel(modelId);
      globalThis.ZeroLatencyDebugEvents?.record?.("ai.lmstudio.unload", {
        ok: result?.ok === true,
        modelId,
        reason,
      });
      return result;
    } catch (error) {
      globalThis.ZeroLatencyDebugEvents?.record?.("ai.lmstudio.unload.error", {
        modelId,
        reason,
        error: String(error?.message || error),
      });
      return { ok: false, error: String(error?.message || error) };
    }
  }

  async function ensureLmStudioLifecycleWatchdog(settings, options = {}) {
    if (globalThis.ZeroLatencySupport?.hasChromeNamespaceMethod?.("alarms", "create") !== true) {
      return;
    }

    if (options.forceDisabled === true || !isLmStudioRuntimeEnabled(settings)) {
      await chrome.alarms.clear(LM_STUDIO_LIFECYCLE_ALARM);
      nonChromeFullscreenSinceAt = null;
      return;
    }

    const periodInMinutes = LM_STUDIO_LIFECYCLE_INTERVAL_SECONDS / 60;

    await chrome.alarms.create(LM_STUDIO_LIFECYCLE_ALARM, {
      delayInMinutes: periodInMinutes,
      periodInMinutes,
    });
  }

  async function maintainLmStudioModelLifecycle(settings = getEffectiveExtensionSettings()) {
    if (!isLmStudioRuntimeEnabled(settings)) {
      await unloadConfiguredLmStudioModel(settings, "lmstudio-runtime-inactive");
      await ensureLmStudioLifecycleWatchdog(settings);
      return;
    }

    const activity = await fetchNativeApp("/api/v1/system/activity", {
      method: "GET",
      timeoutMs: 1_500,
    }).catch(() => null);

    if (!activity || typeof activity !== "object") {
      activityQueryFailureCount += 1;

      if (activityQueryFailureCount >= ACTIVITY_QUERY_FAILURE_UNLOAD_THRESHOLD) {
        await unloadConfiguredLmStudioModel(settings, "activity-query-unavailable");
      }

      return;
    }

    activityQueryFailureCount = 0;

    if (activity?.chromeRunning === false) {
      await unloadConfiguredLmStudioModel(settings, "chrome-not-running");
      return;
    }

    if (activity?.nonChromeFullscreen === true) {
      nonChromeFullscreenSinceAt = nonChromeFullscreenSinceAt ?? Date.now();

      if (Date.now() - nonChromeFullscreenSinceAt >= NON_CHROME_FULLSCREEN_UNLOAD_AFTER_MS) {
        await unloadConfiguredLmStudioModel(settings, "non-chrome-fullscreen");
      }

      return;
    }

    nonChromeFullscreenSinceAt = null;
  }

  function isLmStudioLifecycleAlarm(alarmName) {
    return alarmName === LM_STUDIO_LIFECYCLE_ALARM;
  }

  function isLmStudioRuntimeEnabled(settings) {
    const aiPrediction = settings?.preloading?.aiPrediction ?? {};

    return (
      settings?.preloading?.enabled === true &&
      aiPrediction.enabled === true &&
      isLmStudioProvider(aiPrediction.providerId) &&
      typeof aiPrediction.modelId === "string" &&
      aiPrediction.modelId.trim().length > 0
    );
  }

  Object.assign(namespace, {
    LM_STUDIO_LIFECYCLE_ALARM,
    ensureLmStudioModelReady,
    unloadConfiguredLmStudioModel,
    ensureLmStudioLifecycleWatchdog,
    maintainLmStudioModelLifecycle,
    isLmStudioLifecycleAlarm,
  });
})();
