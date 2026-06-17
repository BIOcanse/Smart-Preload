(() => {
  function createAiModelWarning({
    elements,
    warningElement,
    settingsApi,
    translate,
  } = {}) {
    const t = (key, substitutions = [], fallback = "") =>
      translate?.(key, substitutions, fallback) || fallback || key;

    function syncMismatchWarning() {
      if (!warningElement) {
        return;
      }

      const aiPredictionEnabled = elements.aiPredictionEnabled.checked === true;
      const providerId = String(elements.aiPredictionProvider.value || "");
      const provider = settingsApi?.AI_PROVIDER_BY_ID?.[providerId];
      const providerLabel = provider?.label || providerId || t("commonProvider", [], "provider");
      const modelId = String(elements.aiPredictionModel.value || "").trim();
      const apiKey = String(elements.aiProviderApiKey.value || "").trim();
      const endpointUrl = String(elements.aiProviderEndpoint.value || "").trim();

      if (!aiPredictionEnabled) {
        warningElement.classList.add("is-hidden");
        warningElement.textContent = "";
        return;
      }

      if (!provider || !modelId || !endpointUrl || (!apiKey && provider.apiKeyOptional !== true)) {
        warningElement.textContent = t(
          "settingsAiProviderMissingWarning",
          [providerLabel],
          `AI scoring will stay disabled until ${providerLabel} has a model, endpoint, and API key.`
        );
        warningElement.classList.remove("is-hidden");
        return;
      }

      warningElement.classList.add("is-hidden");
      warningElement.textContent = "";
    }

    return {
      syncMismatchWarning,
    };
  }

  globalThis.ZeroLatencySettingsAiModelWarning = {
    create: createAiModelWarning,
  };
})();
