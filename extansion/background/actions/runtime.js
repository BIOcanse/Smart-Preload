(function () {
  async function executeRuntimeDecision(decision, envelope) {
    if (!decision || decision.disposition === "ignore") {
      return;
    }

    switch (decision.actionKey) {
      case "bootstrap-extension":
        await initializeExtensionState();
        await applyRuntimeSettingsAction();
        return;
      case "handle-installed":
        await initializeExtensionState();
        await applyRuntimeSettingsAction();
        console.log("Zero-Latency Web visit tracker installed.");
        return;
      case "handle-startup":
        await initializeExtensionState();
        await applyRuntimeSettingsAction();
        return;
      case "handle-storage-settings-change":
        backgroundState.setCachedSettings(
          envelope.raw?.changes?.[SETTINGS_STORAGE_KEY]?.newValue
        );
        await applyRuntimeSettingsAction();
        return;
      default:
        return;
    }
  }

  async function applyRuntimeSettingsAction() {
    const runtimeSettings = getEffectiveExtensionSettings();
    const servicePaused = await isExtensionServicePaused();

    if (servicePaused || !runtimeSettings.preloading.enabled) {
      await ensurePreloadWindowWatchdog();
      await resetPreloads();
      return;
    }

    await globalThis.ZeroLatencySupport.probeNativeAppAvailability();
    maybeSyncAiModelStatusInBackground();
    await ensurePreloadWindowWatchdog();

    await globalThis.ZeroLatencyPreloadRuntimeManager.maintain();
    await requestPreloadCandidateRefreshForOpenTabs();
  }

  const AI_STATUS_RETRY_DELAYS_MS = [3_000, 8_000, 20_000];
  let aiStatusRetryPending = false;

  function maybeSyncAiModelStatusInBackground() {
    const featureSupport = globalThis.ZeroLatencySupport?.getBackgroundFeatureSupport?.() ?? {};

    if (featureSupport.aiModelManagement !== true) {
      return;
    }

    if (featureSupport.aiModelManagementUsable === true) {
      void queueSideEffect(async () => {
        try {
          await globalThis.ZeroLatencyCoreAiModelMessages.handleAiModelStatus();
        } catch (error) {
          console.debug("Failed to synchronize AI model status during runtime bootstrap.", error);
        }
      });
      return;
    }

    scheduleAiStatusReprobeRetries();
  }

  function scheduleAiStatusReprobeRetries() {
    if (aiStatusRetryPending) {
      return;
    }

    aiStatusRetryPending = true;

    for (const delayMs of AI_STATUS_RETRY_DELAYS_MS) {
      setTimeout(async () => {
        if (await isExtensionServicePaused()) {
          aiStatusRetryPending = false;
          return;
        }

        const supportApi = globalThis.ZeroLatencySupport;

        if (supportApi?.getBackgroundFeatureSupport?.().aiModelManagementUsable === true) {
          aiStatusRetryPending = false;
          return;
        }

        const becameAvailable = await supportApi?.probeNativeAppAvailability?.();

        if (becameAvailable !== true) {
          return;
        }

        aiStatusRetryPending = false;

        try {
          await globalThis.ZeroLatencyCoreAiModelMessages.handleAiModelStatus();
        } catch (error) {
          console.debug("AI status reprobe sync failed.", error);
        }
      }, delayMs);
    }

    setTimeout(() => {
      aiStatusRetryPending = false;
    }, AI_STATUS_RETRY_DELAYS_MS[AI_STATUS_RETRY_DELAYS_MS.length - 1] + 1_000);
  }

  globalThis.ZeroLatencyRuntimeActions = {
    executeRuntimeDecision,
    applyRuntimeSettingsAction,
  };
})();
