(() => {
  const { providers } = globalThis.ZeroLatencyAiModelCatalogProviders;
  const { primaryModelDirectory, defaultTestConfig } =
    globalThis.ZeroLatencyAiModelCatalogDefaults;
  const {
    providerOptions,
    providersById,
    getProvider,
    getModel,
    getRequestParams,
  } = globalThis.ZeroLatencyAiModelCatalogLookup;

  globalThis.ZeroLatencyAiModelCatalog = {
    providers,
    providerOptions,
    providersById,
    primaryModelDirectory,
    defaultTestConfig,
    getProvider,
    getModel,
    getRequestParams,
  };
})();
