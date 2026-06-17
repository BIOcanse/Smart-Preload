(() => {
  const { JSON_EXTRACTION_DEFAULTS, providerOptionOrder } =
    globalThis.ZeroLatencyAiModelCatalogDefaults;
  const { providers } = globalThis.ZeroLatencyAiModelCatalogProviders;

  const providerOptions = providers
    .map((provider) => ({
      value: provider.value,
      label: provider.label,
      defaultModelId: provider.defaultModelId,
      endpointUrl: provider.endpointUrl,
      apiKeyOptional: provider.apiKeyOptional === true,
    }))
    .sort(
      (left, right) =>
        providerOptionOrder.indexOf(left.value) - providerOptionOrder.indexOf(right.value)
    );
  const providersById = Object.fromEntries(
    providers.map((provider) => [provider.value, provider])
  );

  function getProvider(providerId) {
    return providersById[providerId] ?? null;
  }

  function getModel(providerId, modelId) {
    const provider = getProvider(providerId);
    const normalizedModelId = String(modelId || provider?.defaultModelId || "").trim();

    if (!provider || !normalizedModelId) {
      return null;
    }

    return (
      provider.models?.find((model) => model.id === normalizedModelId) ??
      provider.models?.find((model) =>
        Array.isArray(model.aliases) && model.aliases.includes(normalizedModelId)
      ) ??
      null
    );
  }

  function getRequestParams(providerId, modelId) {
    const provider = getProvider(providerId);
    const model = getModel(providerId, modelId);

    return {
      ...JSON_EXTRACTION_DEFAULTS,
      ...(provider?.requestDefaults ?? {}),
      ...(model?.params ?? {}),
    };
  }

  globalThis.ZeroLatencyAiModelCatalogLookup = {
    providerOptions,
    providersById,
    getProvider,
    getModel,
    getRequestParams,
  };
})();
