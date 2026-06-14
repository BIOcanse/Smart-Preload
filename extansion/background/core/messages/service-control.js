(function () {
  async function handleGetServiceState() {
    return {
      ok: true,
      serviceState:
        typeof getCachedServiceState === "function"
          ? getCachedServiceState()
          : await loadServiceState(),
    };
  }

  async function handleSetServicePaused(message) {
    const serviceState = normalizeServiceState({
      paused: message?.paused === true,
      updatedAt: new Date().toISOString(),
    });

    await saveServiceState(serviceState);

    if (serviceState.paused) {
      await unloadLmStudioModelForInactiveRuntime("service-paused");
      await globalThis.ZeroLatencyAiProviders?.ensureLmStudioLifecycleWatchdog?.(
        getEffectiveExtensionSettings(),
        { forceDisabled: true }
      );
      await globalThis.ZeroLatencyPreloadWindowPolicy.ensurePreloadWindowWatchdog();
      await clearSpeculationRulesForOpenTabs();
      await resetPreloads();
    } else {
      await globalThis.ZeroLatencyRuntimeActions.applyRuntimeSettingsAction();
    }

    globalThis.ZeroLatencyDebugEvents?.record?.("service-control.paused-changed", {
      paused: serviceState.paused,
      updatedAt: serviceState.updatedAt,
    });

    return {
      ok: true,
      serviceState,
    };
  }

  async function unloadLmStudioModelForInactiveRuntime(reason) {
    const settings = getEffectiveExtensionSettings();
    await globalThis.ZeroLatencyAiProviders?.unloadConfiguredLmStudioModel?.(settings, reason);
  }

  async function clearSpeculationRulesForOpenTabs() {
    if (
      globalThis.ZeroLatencySupport?.hasChromeNamespaceMethod?.("tabs", "query") !== true ||
      globalThis.ZeroLatencySupport?.hasChromeNamespaceMethod?.("tabs", "sendMessage") !== true
    ) {
      return;
    }

    const tabs = await chrome.tabs.query({});

    await Promise.allSettled(
      tabs
        .filter((tab) => Number.isFinite(tab?.id))
        .map((tab) =>
          chrome.tabs.sendMessage(tab.id, {
            type: "preload:clear-speculation-rules",
          })
        )
    );
  }

  globalThis.ZeroLatencyCoreServiceControlMessages = {
    handleGetServiceState,
    handleSetServicePaused,
  };
})();
