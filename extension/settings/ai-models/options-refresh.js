(() => {
  const MODEL_OPTIONS_DEBOUNCE_MS = 400;

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
  } = {}) {
    const t = (key, substitutions = [], fallback = "") =>
      translate?.(key, substitutions, fallback) || fallback || key;
    let modelOptionsRequestId = 0;
    let scheduledRefresh = null;
    let activeRequest = null;

    function refreshOptionsForCurrentProvider() {
      return scheduleModelOptionsRefresh(readCurrentRequest());
    }

    function readCurrentRequest() {
      const providerId = String(elements.aiPredictionProvider.value || "");
      const provider = settingsApi?.AI_PROVIDER_BY_ID?.[providerId] ?? {};
      const providerIsLmStudio = isProviderLmStudio?.(providerId) === true;

      return {
        providerId,
        selectedModelId: String(elements.aiPredictionModel.value || "").trim(),
        apiKey: providerIsLmStudio
          ? ""
          : String(elements.aiProviderApiKey.value || "").trim(),
        endpointUrl: providerIsLmStudio
          ? provider.endpointUrl || globalThis.ZeroLatencyLmStudio?.CHAT_COMPLETIONS_URL || ""
          : String(elements.aiProviderEndpoint.value || "").trim(),
      };
    }

    function scheduleModelOptionsRefresh(request) {
      cancelScheduledRefresh("superseded");
      activeRequest?.controller.abort();

      const requestId = ++modelOptionsRequestId;

      return new Promise((resolve) => {
        scheduledRefresh = {
          requestId,
          resolve,
          timerId: setTimeout(async () => {
            scheduledRefresh = null;
            resolve(await runModelOptionsRefresh(request, requestId));
          }, MODEL_OPTIONS_DEBOUNCE_MS),
        };
      });
    }

    async function refreshModelOptions(request) {
      cancelScheduledRefresh("immediate-refresh");
      activeRequest?.controller.abort();

      const requestId = ++modelOptionsRequestId;
      return await runModelOptionsRefresh(request, requestId);
    }

    async function runModelOptionsRefresh(request, requestId) {
      const controller = new AbortController();
      activeRequest = { requestId, controller };

      try {
        return await loadAndRenderModelOptions(request, requestId, controller.signal);
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          return { status: "cancelled" };
        }
        console.error(error);
        renderUnexpectedError(request, error);
        return {
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        if (activeRequest?.requestId === requestId) {
          activeRequest = null;
        }
      }
    }

    function renderUnexpectedError({ providerId, selectedModelId }, error) {
      const models = modelSelect.getCuratedAiModelOptions(providerId);

      modelSelect.renderModelSelectOptions({
        providerId,
        selectedModelId,
        models,
        disabled: models.length === 0,
        placeholder:
          models.length === 0
            ? t("settingsAiNoModelsFound", [], "No models found")
            : "",
      });
      elements.aiPredictionModel.title = `Could not load provider models; showing curated presets. ${
        error instanceof Error ? error.message : String(error)
      }`;
    }

    async function loadAndRenderModelOptions(
      { providerId, selectedModelId, apiKey, endpointUrl },
      requestId,
      signal
    ) {
      const provider = settingsApi?.AI_PROVIDER_BY_ID?.[providerId];

      if (!provider) {
        modelSelect.renderModelSelectOptions({
          providerId,
          selectedModelId: "",
          models: [],
          disabled: true,
          placeholder: t("settingsAiSelectProviderFirst", [], "Select a provider first"),
        });
        return { status: "missing-provider" };
      }

      if (!apiKey && provider.apiKeyOptional !== true) {
        modelSelect.renderModelSelectOptions({
          providerId,
          selectedModelId,
          models: [],
          disabled: true,
          placeholder: t("settingsAiEnterKeyToLoadModels", [], "Enter an API key to load models"),
        });
        return { status: "missing-key" };
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
        signal,
      });

      if (signal.aborted || requestId !== modelOptionsRequestId || result?.status === "cancelled") {
        return { status: "cancelled" };
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

      return result;
    }

    function cancelScheduledRefresh(reason = "cancelled") {
      if (!scheduledRefresh) {
        return;
      }

      clearTimeout(scheduledRefresh.timerId);
      scheduledRefresh.resolve({ status: "cancelled", reason });
      scheduledRefresh = null;
    }

    function dispose() {
      cancelScheduledRefresh("disposed");
      activeRequest?.controller.abort();
      activeRequest = null;
    }

    return {
      refreshOptionsForCurrentProvider,
      refreshModelOptions,
      dispose,
    };
  }

  function buildModelListTitle({ result, modelListMode, modelCount, displayCount, translate }) {
    const timeoutSeconds = Math.ceil(Number(result?.timeoutMs || 0) / 1000);
    const message =
      result?.status === "timeout"
        ? translate?.(
            "settingsAiModelListRequestTimedOut",
            [timeoutSeconds],
            `The model list request stopped after ${timeoutSeconds} seconds; curated presets are shown instead.`
          )
        : result?.message || "";
    const performanceAdvice =
      result?.status === "timeout"
        ? translate?.(
            "settingsAiModelSelectionAdvice",
            [],
            "Prefer a fast, inexpensive text or chat model when possible."
          )
        : "";

    if (modelListMode === "all" || modelCount <= displayCount) {
      return [message, performanceAdvice].filter(Boolean).join(" ");
    }

    const suffix = translate?.(
      "settingsAiModelListRecommendedTitle",
      [displayCount, modelCount],
      `Showing ${displayCount} latest recommended models from ${modelCount} loaded models. Switch to All models to see every option.`
    );

    return [message, suffix, performanceAdvice].filter(Boolean).join(" ");
  }

  function isAbortError(error) {
    return error?.name === "AbortError";
  }

  globalThis.ZeroLatencySettingsAiModelOptionsRefresher = {
    MODEL_OPTIONS_DEBOUNCE_MS,
    create: createAiModelOptionsRefresher,
  };
})();
