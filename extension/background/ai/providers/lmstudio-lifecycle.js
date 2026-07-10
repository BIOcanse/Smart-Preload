(function () {
  const namespace = (globalThis.ZeroLatencyAiProviderModules =
    globalThis.ZeroLatencyAiProviderModules || {});
  const { isLmStudioProvider } = namespace;
  const LM_STUDIO_OPERATION_TIMEOUT_MS = 20_000;
  const LM_STUDIO_LIFECYCLE_ALARM = "ai-lmstudio-lifecycle-watchdog";
  const LM_STUDIO_LIFECYCLE_INTERVAL_SECONDS = 30;
  const NON_CHROME_FULLSCREEN_UNLOAD_AFTER_MS = 5_000;
  const ACTIVITY_QUERY_FAILURE_UNLOAD_THRESHOLD = 3;
  let lmStudioLoadState = {
    modelId: "",
    promise: null,
  };
  let desiredLmStudioModelId = "";
  const managedLmStudioModelIds = new Set();
  let lifecycleDecisionId = 0;
  let nonChromeFullscreenSinceAt = null;
  let activityQueryFailureCount = 0;

  async function ensureLmStudioModelReady(modelId) {
    const lmStudio = globalThis.ZeroLatencyLmStudio;
    const normalizedModelId = typeof modelId === "string" ? modelId.trim() : "";

    if (!normalizedModelId || typeof lmStudio?.getModelStatus !== "function") {
      return false;
    }

    const decisionId = ++lifecycleDecisionId;
    await unloadManagedLmStudioModelsExcept(normalizedModelId, "inference-model-changed");

    if (decisionId !== lifecycleDecisionId) {
      return false;
    }

    desiredLmStudioModelId = normalizedModelId;

    const status = await lmStudio.getModelStatus(normalizedModelId).catch(() => null);

    if (status?.loaded) {
      managedLmStudioModelIds.add(normalizedModelId);
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
        const operationStartedAt = Date.now();
        await lmStudio.loadModel(modelId, { timeoutMs: LM_STUDIO_OPERATION_TIMEOUT_MS });
        const remainingTimeoutMs = Math.max(
          1,
          LM_STUDIO_OPERATION_TIMEOUT_MS - (Date.now() - operationStartedAt)
        );
        const loaded = await lmStudio.waitForModelLoaded(modelId, {
          timeoutMs: remainingTimeoutMs,
          requestTimeoutMs: Math.min(5_000, remainingTimeoutMs),
        });

        if (loaded?.ok === true) {
          managedLmStudioModelIds.add(modelId);

          if (desiredLmStudioModelId !== modelId) {
            await unloadManagedLmStudioModel(modelId, "stale-load-completed");
          }
        }

        return loaded;
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
    const configuredModelId =
      isLmStudioProvider(aiPrediction.providerId) && typeof aiPrediction.modelId === "string"
        ? aiPrediction.modelId.trim()
        : "";
    const modelIds = new Set([
      configuredModelId,
      lmStudioLoadState.modelId,
      ...managedLmStudioModelIds,
    ]);
    modelIds.delete("");
    lifecycleDecisionId += 1;
    desiredLmStudioModelId = "";

    if (
      modelIds.size === 0 ||
      typeof lmStudio?.unloadModel !== "function"
    ) {
      return { ok: true, skipped: true, reason: "not-lmstudio" };
    }

    const results = await Promise.all(
      Array.from(modelIds, (modelId) => unloadManagedLmStudioModel(modelId, reason))
    );

    const failed = results.find((result) => result?.ok !== true);
    return failed ?? { ok: true, unloadedModelIds: Array.from(modelIds) };
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

    void maintainLmStudioModelLifecycle(settings).catch((error) => {
      globalThis.ZeroLatencyDebugEvents?.record?.("ai.lmstudio.maintain.error", {
        error: String(error?.message || error),
      });
    });
  }

  async function maintainLmStudioModelLifecycle(settings = getEffectiveExtensionSettings()) {
    const decisionId = ++lifecycleDecisionId;

    if (!isLmStudioRuntimeEnabled(settings)) {
      await unloadConfiguredLmStudioModel(settings, "lmstudio-runtime-inactive");
      await ensureLmStudioLifecycleWatchdog(settings);
      return;
    }

    const activity = await fetchNativeApp("/api/v1/system/activity", {
      method: "GET",
      timeoutMs: 1_500,
    }).catch(() => null);

    if (decisionId !== lifecycleDecisionId) {
      return;
    }

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
    const modelId = getConfiguredLmStudioModelId(settings);
    await unloadManagedLmStudioModelsExcept(modelId, "configured-model-changed");

    if (decisionId !== lifecycleDecisionId) {
      return;
    }

    desiredLmStudioModelId = modelId;
    startLmStudioModelLoad(modelId);
  }

  async function unloadManagedLmStudioModelsExcept(modelIdToKeep, reason) {
    const staleModelIds = Array.from(
      managedLmStudioModelIds,
      (modelId) => modelId
    ).filter((modelId) => modelId !== modelIdToKeep);

    if (staleModelIds.length === 0) {
      return;
    }

    await Promise.all(
      staleModelIds.map((modelId) => unloadManagedLmStudioModel(modelId, reason))
    );
  }

  async function unloadManagedLmStudioModel(modelId, reason) {
    const lmStudio = globalThis.ZeroLatencyLmStudio;

    try {
      const result = await lmStudio.unloadModel(modelId, {
        timeoutMs: LM_STUDIO_OPERATION_TIMEOUT_MS,
      });
      if (result?.ok === true) {
        managedLmStudioModelIds.delete(modelId);
      }
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

  function getConfiguredLmStudioModelId(settings) {
    const aiPrediction = settings?.preloading?.aiPrediction ?? {};

    return isLmStudioProvider(aiPrediction.providerId) &&
      typeof aiPrediction.modelId === "string"
      ? aiPrediction.modelId.trim()
      : "";
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
