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
    globalThis.ZeroLatencyDiagnostics?.configureFromSettings?.(runtimeSettings);

    if (servicePaused) {
      await globalThis.ZeroLatencyNativeAppHeartbeat?.ensureAlarm?.(false);
      await globalThis.ZeroLatencyAiProviders?.unloadConfiguredLmStudioModel?.(
        runtimeSettings,
        "service-paused"
      );
      await globalThis.ZeroLatencyAiProviders?.ensureLmStudioLifecycleWatchdog?.(runtimeSettings, {
        forceDisabled: true,
      });
      await ensurePreloadWindowWatchdog();
      await resetPreloads();
      return;
    }

    await globalThis.ZeroLatencyNativeAppHeartbeat?.ensureAlarm?.(true);
    await globalThis.ZeroLatencySupport.probeNativeAppAvailability({
      forceRefresh: false,
    });
    void globalThis.ZeroLatencyNativeAppHeartbeat?.send?.("runtime-settings");
    await ensurePreloadWindowWatchdog();

    if (!runtimeSettings.preloading.enabled) {
      await globalThis.ZeroLatencyAiProviders?.unloadConfiguredLmStudioModel?.(
        runtimeSettings,
        "preloading-disabled"
      );
      await globalThis.ZeroLatencyAiProviders?.ensureLmStudioLifecycleWatchdog?.(runtimeSettings, {
        forceDisabled: true,
      });
      await resetPreloads();
      return;
    }

    await globalThis.ZeroLatencyAiProviders?.ensureLmStudioLifecycleWatchdog?.(runtimeSettings);

    await globalThis.ZeroLatencyPreloadRuntimeManager.ensureWarmWindows?.();
    await globalThis.ZeroLatencyPreloadRuntimeManager.maintain();
    await requestPreloadCandidateRefreshForOpenTabs();
  }

  globalThis.ZeroLatencyRuntimeActions = {
    executeRuntimeDecision,
    applyRuntimeSettingsAction,
  };
})();
