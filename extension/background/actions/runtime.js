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
        // 刚装好就是用户在主动要这个功能，清掉可能残留的配对退避。
        await clearNativeAppPairingBackoffForUserAction("installed");
        await applyRuntimeSettingsAction();
        console.log("Smart Preload extension installed.");
        return;
      case "handle-startup":
        await initializeExtensionState();
        await applyRuntimeSettingsAction();
        return;
      case "handle-storage-settings-change":
        backgroundState.setCachedSettings(
          envelope.raw?.changes?.[SETTINGS_STORAGE_KEY]?.newValue
        );
        // 用户刚在设置页保存过 —— 这是明确的用户动作，清掉配对退避，
        // 让「我就是要连本地 App」能立刻生效，而不用等十分钟。
        await clearNativeAppPairingBackoffForUserAction("settings-saved");
        await applyRuntimeSettingsAction();
        return;
      default:
        return;
    }
  }

  // 只在**用户动作**上调用。自动恢复路径用的是 `resetNativeAppRegistration()`，
  // 那条绝不能碰退避（见 native-app/request/registration.js 顶部）。
  async function clearNativeAppPairingBackoffForUserAction(reason) {
    try {
      await globalThis.ZeroLatencyNativeAppRequestModules?.clearNativeAppPairingBackoff?.();
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.pairing-backoff.cleared", {
        reason,
      });
    } catch (error) {
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.pairing-backoff.clear-error", {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
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
    void sendImmediateNativeAppHeartbeat("runtime-settings");
    await globalThis.ZeroLatencySupport.probeNativeAppAvailability({
      forceRefresh: true,
    });
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

    await clearExcludedIncognitoPreloadStateForRuntime(runtimeSettings);
    await clearProxySkippedPreloadStateForRuntime(runtimeSettings);
    const allNativePreloadMode =
      globalThis.ZeroLatencyPreloadNativeOnlyPolicy?.isAllNativePreloadModeEnabled?.(
        runtimeSettings
      ) === true;
    if (allNativePreloadMode) {
      await clearHiddenTabPreloadStateForAllNativeMode(runtimeSettings);
    } else {
      await globalThis.ZeroLatencyPreloadRuntimeManager.ensureWarmWindows?.();
    }
    await globalThis.ZeroLatencyPreloadRuntimeManager.maintain();
    await requestPreloadCandidateRefreshForOpenTabs();
  }

  async function clearExcludedIncognitoPreloadStateForRuntime(runtimeSettings) {
    if (
      globalThis.ZeroLatencyPreloadIncognitoPolicy?.isIncognitoPreloadExclusionEnabled?.(
        runtimeSettings
      ) !== true
    ) {
      return;
    }

    const preloadState = await loadPreloadState();
    const cleanup =
      await globalThis.ZeroLatencyPreloadIncognitoPolicy.clearExcludedIncognitoPreloadState(
        preloadState,
        runtimeSettings,
        {
          reason: "runtime-settings",
        }
      );

    if (cleanup.mutated) {
      await savePreloadState(cleanup.preloadState);
    }
  }

  async function clearProxySkippedPreloadStateForRuntime(runtimeSettings) {
    if (
      globalThis.ZeroLatencyPreloadProxySkipPolicy?.isProxySkipPreloadEnabled?.(
        runtimeSettings
      ) !== true
    ) {
      return;
    }

    const preloadState = await loadPreloadState();
    const cleanup =
      await globalThis.ZeroLatencyPreloadProxySkipPolicy.clearProxySkippedPreloadState(
        preloadState,
        runtimeSettings,
        {
          reason: "runtime-settings",
        }
      );

    if (cleanup.mutated) {
      await savePreloadState(cleanup.preloadState);
    }
  }

  async function clearHiddenTabPreloadStateForAllNativeMode(runtimeSettings) {
    const preloadState = await loadPreloadState();
    const cleanup =
      await globalThis.ZeroLatencyPreloadNativeOnlyPolicy?.clearHiddenTabPreloadStateForNativeOnlyMode?.(
        preloadState,
        runtimeSettings,
        {
          reason: "runtime-settings",
        }
      );

    if (cleanup?.mutated) {
      await savePreloadState(cleanup.preloadState);
    }
  }

  async function sendImmediateNativeAppHeartbeat(reason) {
    try {
      await globalThis.ZeroLatencyNativeAppHeartbeat?.send?.(reason);
    } catch (error) {
      globalThis.ZeroLatencyDebugEvents?.record?.("native-app.heartbeat.immediate-error", {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  globalThis.ZeroLatencyRuntimeActions = {
    executeRuntimeDecision,
    applyRuntimeSettingsAction,
  };
})();
