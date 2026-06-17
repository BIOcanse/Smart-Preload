(() => {
  function createAiModelOptionsRefresher({
    elements,
    settingsApi,
    modelLoader,
    modelSelect,
    translate,
    isProviderLmStudio,
    readFormSettings,
    setDraftSettings,
    updateComputedState,
    syncMismatchWarning,
    ensureSelectedLmStudioModelLoaded,
  } = {}) {
    const t = (key, substitutions = [], fallback = "") =>
      translate?.(key, substitutions, fallback) || fallback || key;
    let modelOptionsRequestId = 0;

    async function refreshOptionsForCurrentProvider() {
      const providerId = String(elements.aiPredictionProvider.value || "");
      const provider = settingsApi?.AI_PROVIDER_BY_ID?.[providerId] ?? {};
      const providerIsLmStudio = isProviderLmStudio?.(providerId) === true;
      const selectedModelId = String(elements.aiPredictionModel.value || "").trim();
      const apiKey = providerIsLmStudio
        ? ""
        : String(elements.aiProviderApiKey.value || "").trim();
      const endpointUrl = providerIsLmStudio
        ? provider.endpointUrl || globalThis.ZeroLatencyLmStudio?.CHAT_COMPLETIONS_URL || ""
        : String(elements.aiProviderEndpoint.value || "").trim();
      await refreshModelOptions({
        providerId,
        selectedModelId,
        apiKey,
        endpointUrl,
      });
    }

    async function refreshModelOptions({ providerId, selectedModelId, apiKey, endpointUrl }) {
      const provider = settingsApi?.AI_PROVIDER_BY_ID?.[providerId];
      const requestId = ++modelOptionsRequestId;

      if (!provider) {
        modelSelect.renderModelSelectOptions({
          providerId,
          selectedModelId: "",
          models: [],
          disabled: true,
          placeholder: t("settingsAiSelectProviderFirst", [], "Select a provider first"),
        });
        return;
      }

      if (!apiKey && provider.apiKeyOptional !== true) {
        modelSelect.renderModelSelectOptions({
          providerId,
          selectedModelId,
          models: [],
          disabled: true,
          placeholder: t("settingsAiEnterKeyToLoadModels", [], "Enter an API key to load models"),
        });
        return;
      }

      modelSelect.renderModelSelectOptions({
        providerId,
        selectedModelId,
        models: modelSelect.getCuratedAiModelOptions(providerId),
        disabled: false,
        placeholder: t("settingsAiLoadingModelsGeneric", [], "Loading models..."),
      });

      const result = await modelLoader?.loadProviderModelOptions?.({
        providerId,
        provider,
        endpointUrl,
        apiKey,
      });

      if (requestId !== modelOptionsRequestId) {
        return;
      }

      const models = Array.isArray(result?.models)
        ? result.models
        : modelSelect.getCuratedAiModelOptions(providerId);
      const modelListMode =
        readFormSettings?.()?.preloading?.aiPrediction?.modelListMode ||
        elements.aiModelListMode?.value ||
        "recommended";
      const displayModels =
        globalThis.ZeroLatencySettingsAiModelRecommendations?.selectModelsForListMode?.({
          models,
          mode: modelListMode,
          providerId,
          selectedModelId,
        }) ?? models;
      const selectedAfterRender = modelSelect.renderModelSelectOptions({
        providerId,
        selectedModelId,
        models: displayModels,
        disabled: displayModels.length === 0,
        placeholder:
          displayModels.length === 0
            ? t("settingsAiNoModelsFound", [], "No models found")
            : "",
      });

      elements.aiPredictionModel.title = buildModelListTitle({
        result,
        modelListMode,
        modelCount: models.length,
        displayCount: displayModels.length,
        translate: t,
      });

      if (selectedAfterRender !== selectedModelId) {
        const nextSettings = readFormSettings?.();
        if (nextSettings) {
          setDraftSettings?.(nextSettings);
          updateComputedState?.(nextSettings);
          syncMismatchWarning?.();
        }
      }

      if (isProviderLmStudio?.(providerId) === true && elements.aiPredictionEnabled.checked === true) {
        const settings = readFormSettings?.();
        if (settings) {
          void ensureSelectedLmStudioModelLoaded?.(settings);
        }
      }
    }

    return {
      refreshOptionsForCurrentProvider,
      refreshModelOptions,
    };
  }

  function buildModelListTitle({ result, modelListMode, modelCount, displayCount, translate }) {
    const message = result?.message || "";

    if (modelListMode === "all" || modelCount <= displayCount) {
      return message;
    }

    const suffix = translate?.(
      "settingsAiModelListRecommendedTitle",
      [displayCount, modelCount],
      `Showing ${displayCount} latest recommended models from ${modelCount} loaded models. Switch to All models to see every option.`
    );

    return message ? `${message} ${suffix}` : suffix;
  }

  globalThis.ZeroLatencySettingsAiModelOptionsRefresher = {
    create: createAiModelOptionsRefresher,
  };
})();
