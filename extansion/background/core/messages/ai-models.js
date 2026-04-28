(function () {
  const settingsApi = globalThis.ZeroLatencySettings;

  function modelManagerStateEquals(leftValue, rightValue) {
    return JSON.stringify(leftValue ?? null) === JSON.stringify(rightValue ?? null);
  }

  async function syncAiModelManagerSettingsWithNativeStatus(nativeStatus) {
    const storedSettings = await settingsApi.loadSettings(chrome.storage.local);
    const nextSettings = settingsApi.normalizeStoredSettings({
      ...storedSettings,
      preloading: {
        ...storedSettings.preloading,
        modelManager: {
          ...storedSettings.preloading.modelManager,
          downloadedModels: buildDownloadedModelsFromNativeStatus(nativeStatus),
          installedRuntimeIds: buildInstalledRuntimeIdsFromNativeStatus(nativeStatus),
        },
      },
    });

    if (
      modelManagerStateEquals(
        storedSettings.preloading?.modelManager,
        nextSettings.preloading?.modelManager
      )
    ) {
      return storedSettings;
    }

    await settingsApi.saveSettings(chrome.storage.local, nextSettings);
    backgroundState.setCachedSettings(nextSettings);
    return nextSettings;
  }

  function buildDownloadedModelsFromNativeStatus(nativeStatus) {
    const downloadedModels = {};

    for (const model of settingsApi.AI_MODEL_OPTIONS ?? []) {
      downloadedModels[model.value] = false;
    }

    for (const modelStatus of nativeStatus?.models ?? []) {
      if (typeof modelStatus?.id !== "string") {
        continue;
      }

      downloadedModels[modelStatus.id] = modelStatus.downloaded === true;
    }

    return downloadedModels;
  }

  function buildInstalledRuntimeIdsFromNativeStatus(nativeStatus) {
    return (nativeStatus?.runtimes ?? [])
      .filter(
        (runtimeStatus) =>
          runtimeStatus?.installed === true && typeof runtimeStatus?.id === "string"
      )
      .map((runtimeStatus) => runtimeStatus.id);
  }

  async function handleAiModelStatus() {
    const nativeStatus = await nativeAppGetAiStatus();
    const settings = await queueMutation(() =>
      syncAiModelManagerSettingsWithNativeStatus(nativeStatus)
    );
    return {
      ok: true,
      status: nativeStatus,
      settings,
    };
  }

  async function handleAiModelSetInstalled(message) {
    const modelId = String(message?.modelId || "");
    const shouldInstall = message?.installed === true;
    const nativeStatus = shouldInstall
      ? await nativeAppInstallAiModel(modelId)
      : await nativeAppUninstallAiModel(modelId);
    const settings = await queueMutation(() =>
      syncAiModelManagerSettingsWithNativeStatus(nativeStatus)
    );
    return {
      ok: true,
      status: nativeStatus,
      settings,
    };
  }

  async function handleAiModelProgress() {
    try {
      const progress = await nativeAppGetAiProgress();
      return {
        ok: true,
        progress: progress ?? null,
      };
    } catch (error) {
      return {
        ok: false,
        progress: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  globalThis.ZeroLatencyCoreAiModelMessages = {
    buildDownloadedModelsFromNativeStatus,
    buildInstalledRuntimeIdsFromNativeStatus,
    syncAiModelManagerSettingsWithNativeStatus,
    handleAiModelStatus,
    handleAiModelProgress,
    handleAiModelSetInstalled,
  };
})();
