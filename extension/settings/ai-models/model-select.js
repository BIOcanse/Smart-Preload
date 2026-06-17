(() => {
  function createAiModelSelect({
    elements,
    settingsApi,
  } = {}) {
    function renderModelSelectOptions({
      providerId,
      selectedModelId,
      models,
      disabled,
      placeholder,
    }) {
      const normalizedModels = Array.isArray(models) ? models : [];
      const modelSelect = elements.aiPredictionModel;
      const nextSelectedModelId =
        normalizedModels.some((model) => model.id === selectedModelId)
          ? selectedModelId
          : normalizedModels[0]?.id || "";

      modelSelect.textContent = "";

      if (placeholder) {
        const placeholderOption = document.createElement("option");
        placeholderOption.value = "";
        placeholderOption.textContent = placeholder;
        placeholderOption.disabled = normalizedModels.length > 0;
        placeholderOption.selected = !nextSelectedModelId;
        modelSelect.append(placeholderOption);
      }

      for (const model of normalizedModels) {
        const option = document.createElement("option");
        option.value = String(model.id || "");
        option.textContent = formatModelOptionLabel(model);
        modelSelect.append(option);
      }

      modelSelect.value = nextSelectedModelId;
      modelSelect.disabled = Boolean(disabled);
      modelSelect.dataset.providerId = providerId || "";

      return nextSelectedModelId;
    }

    function formatModelOptionLabel(model) {
      const modelId = String(model?.id || "");
      const label = String(model?.label || modelId);
      const suffixes = [];

      if (model?.statusLabel) {
        suffixes.push(String(model.statusLabel));
      }

      if (modelId && label !== modelId) {
        suffixes.push(modelId);
      }

      return suffixes.length > 0 ? `${label} (${suffixes.join(" / ")})` : label;
    }

    function getCuratedAiModelOptions(providerId) {
      return typeof settingsApi?.getAiProviderModels === "function"
        ? settingsApi.getAiProviderModels(providerId)
        : [];
    }

    return {
      renderModelSelectOptions,
      formatModelOptionLabel,
      getCuratedAiModelOptions,
    };
  }

  globalThis.ZeroLatencySettingsAiModelSelect = {
    create: createAiModelSelect,
  };
})();
