(() => {
  function createAiModelControls({
    elements,
    warningElement,
    settingsApi,
    modelLoader = globalThis.ZeroLatencySettingsAiModels,
    translate,
    readFormSettings,
    setDraftSettings,
    updateComputedState,
  } = {}) {
    const t = (key, substitutions = [], fallback = "") =>
      translate?.(key, substitutions, fallback) || fallback || key;
    const modelSelect = globalThis.ZeroLatencySettingsAiModelSelect?.create?.({
      elements,
      settingsApi,
    });
    const warning = globalThis.ZeroLatencySettingsAiModelWarning?.create?.({
      elements,
      warningElement,
      settingsApi,
      translate,
    });
    let modelOptionsRefresher = null;

    function isProviderLmStudio(providerId) {
      return (
        modelLoader?.isLmStudioProvider?.(providerId) === true ||
        globalThis.ZeroLatencyLmStudio?.isLmStudioProvider?.(providerId) === true ||
        String(providerId || "").toLowerCase() === "lmstudio"
      );
    }
    const lmStudioModelLoader = globalThis.ZeroLatencySettingsLmStudioModelLoader?.create?.({
      elements,
      translate,
      isProviderLmStudio,
      refreshOptionsForCurrentProvider: () =>
        modelOptionsRefresher?.refreshOptionsForCurrentProvider?.(),
    });
    modelOptionsRefresher = globalThis.ZeroLatencySettingsAiModelOptionsRefresher?.create?.({
      elements,
      settingsApi,
      modelLoader,
      modelSelect,
      translate,
      isProviderLmStudio,
      readFormSettings,
      setDraftSettings,
      updateComputedState,
      syncMismatchWarning: () => warning?.syncMismatchWarning?.(),
      ensureSelectedLmStudioModelLoaded: (settings) =>
        lmStudioModelLoader?.ensureSelectedLmStudioModelLoaded?.(settings),
    });

    function populateProviderOptions() {
      const providerSelect = elements?.aiPredictionProvider;
      const options = Array.isArray(settingsApi?.AI_PROVIDER_OPTIONS)
        ? settingsApi.AI_PROVIDER_OPTIONS
        : [];

      if (!providerSelect) {
        return;
      }

      providerSelect.textContent = "";

      for (const optionSpec of options) {
        const option = document.createElement("option");
        option.value = String(optionSpec.value);
        option.textContent = optionSpec.label;
        providerSelect.append(option);
      }
    }

    function readFormAiPrediction(draftSettings) {
      const providerId = elements.aiPredictionProvider.value;
      const provider = settingsApi?.AI_PROVIDER_BY_ID?.[providerId] ?? {};
      const providerIsLmStudio = isProviderLmStudio(providerId);
      const aiApiKeys = {
        ...(draftSettings?.preloading?.aiPrediction?.apiKeys ?? {}),
        [providerId]: providerIsLmStudio ? "" : elements.aiProviderApiKey.value.trim(),
      };
      const aiModelIds = {
        ...(draftSettings?.preloading?.aiPrediction?.modelIds ?? {}),
        [providerId]: elements.aiPredictionModel.value.trim(),
      };
      const aiEndpointUrls = {
        ...(draftSettings?.preloading?.aiPrediction?.endpointUrls ?? {}),
        [providerId]: providerIsLmStudio
          ? provider.endpointUrl || globalThis.ZeroLatencyLmStudio?.CHAT_COMPLETIONS_URL || ""
          : elements.aiProviderEndpoint.value.trim(),
      };

      return {
        enabled: elements.aiPredictionEnabled.checked,
        providerId,
        modelId: aiModelIds[providerId],
        modelListMode:
          settingsApi?.normalizeAiModelListMode?.(elements.aiModelListMode?.value) ||
          "recommended",
        apiKeys: aiApiKeys,
        modelIds: aiModelIds,
        endpointUrls: aiEndpointUrls,
      };
    }

    function syncProviderFieldsFromSettings(settings) {
      const aiPrediction = settings?.preloading?.aiPrediction ?? {};
      const providerId = elements.aiPredictionProvider.value || aiPrediction.providerId;
      const provider =
        settingsApi?.AI_PROVIDER_BY_ID?.[providerId] ??
        settingsApi?.AI_PROVIDER_OPTIONS?.[0] ??
        {};
      const providerIsLmStudio = isProviderLmStudio(providerId);
      const modelListMode =
        settingsApi?.normalizeAiModelListMode?.(aiPrediction.modelListMode) ||
        "recommended";
      const modelId =
        aiPrediction.modelIds?.[providerId] ||
        provider.defaultModelId ||
        aiPrediction.modelId ||
        "";
      const apiKey = providerIsLmStudio ? "" : aiPrediction.apiKeys?.[providerId] || "";
      const endpointUrl = providerIsLmStudio
        ? provider.endpointUrl || globalThis.ZeroLatencyLmStudio?.CHAT_COMPLETIONS_URL || ""
        : aiPrediction.endpointUrls?.[providerId] || provider.endpointUrl || "";

      if (elements.aiModelListMode) {
        elements.aiModelListMode.value = modelListMode;
      }
      modelSelect.renderModelSelectOptions({
        providerId,
        selectedModelId: modelId,
        models: modelSelect.getCuratedAiModelOptions(providerId),
        disabled: !apiKey && provider.apiKeyOptional !== true,
        placeholder:
          !apiKey && provider.apiKeyOptional !== true
            ? t("settingsAiEnterKeyToLoadModels", [], "Enter an API key to load models")
            : t("settingsAiLoadingModelsGeneric", [], "Loading models..."),
      });
      elements.aiProviderApiKey.value = apiKey;
      elements.aiProviderEndpoint.value = endpointUrl;
      elements.aiProviderApiKey.disabled = providerIsLmStudio;
      elements.aiProviderEndpoint.disabled = providerIsLmStudio;
      elements.aiProviderApiKey.placeholder =
        providerIsLmStudio
          ? t("settingsAiLmStudioKeyIgnoredPlaceholder", [], "Ignored for LM Studio")
          : provider.apiKeyOptional === true
            ? t("settingsAiKeyOptionalPlaceholder", [], "Optional for local compatible endpoints")
            : t("settingsAiKeyRequiredPlaceholder", [], "Required");
      void modelOptionsRefresher?.refreshModelOptions?.({
        providerId,
        selectedModelId: modelId,
        apiKey,
        endpointUrl,
      });
    }

    return {
      populateProviderOptions,
      readFormAiPrediction,
      syncProviderFieldsFromSettings,
      refreshOptionsForCurrentProvider:
        modelOptionsRefresher?.refreshOptionsForCurrentProvider ?? (async () => {}),
      ensureSelectedLmStudioModelLoaded:
        lmStudioModelLoader?.ensureSelectedLmStudioModelLoaded ?? (() => {}),
      syncMismatchWarning: warning?.syncMismatchWarning ?? (() => {}),
      isLmStudioProvider: isProviderLmStudio,
    };
  }

  globalThis.ZeroLatencySettingsAiModelControls = {
    create: createAiModelControls,
  };
})();
