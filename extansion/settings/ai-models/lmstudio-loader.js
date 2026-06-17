(() => {
  function createLmStudioModelLoader({
    elements,
    translate,
    isProviderLmStudio,
    refreshOptionsForCurrentProvider,
    lmStudio = globalThis.ZeroLatencyLmStudio,
  } = {}) {
    const t = (key, substitutions = [], fallback = "") =>
      translate?.(key, substitutions, fallback) || fallback || key;
    let pendingModelLoadId = "";

    async function ensureSelectedLmStudioModelLoaded(settings) {
      const aiPrediction = settings?.preloading?.aiPrediction ?? {};
      const modelId = String(aiPrediction.modelId || "").trim();

      if (
        aiPrediction.enabled !== true ||
        !isProviderLmStudio?.(aiPrediction.providerId) ||
        !modelId ||
        pendingModelLoadId === modelId ||
        typeof lmStudio?.loadModel !== "function"
      ) {
        return;
      }

      pendingModelLoadId = modelId;
      elements.aiPredictionModel.title = t(
        "settingsAiLmStudioLoadingModel",
        [modelId],
        `Loading LM Studio model: ${modelId}`
      );

      try {
        const status = await lmStudio.getModelStatus(modelId).catch(() => null);
        let didRequestLoad = false;

        if (!status?.loaded) {
          await lmStudio.loadModel(modelId);
          didRequestLoad = true;
          const loaded = await lmStudio.waitForModelLoaded(modelId);

          if (loaded?.ok !== true) {
            throw new Error(loaded?.reason || "model load timed out");
          }
        }

        if (didRequestLoad) {
          await refreshOptionsForCurrentProvider?.();
        }
      } catch (error) {
        elements.aiPredictionModel.title = `LM Studio model load failed: ${
          error instanceof Error ? error.message : String(error)
        }`;
      } finally {
        if (pendingModelLoadId === modelId) {
          pendingModelLoadId = "";
        }
      }
    }

    return {
      ensureSelectedLmStudioModelLoaded,
    };
  }

  globalThis.ZeroLatencySettingsLmStudioModelLoader = {
    create: createLmStudioModelLoader,
  };
})();
