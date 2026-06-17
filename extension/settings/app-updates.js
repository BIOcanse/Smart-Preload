(() => {
  const versionApi = globalThis.ZeroLatencySettingsAppUpdateVersion;
  const catalogApi = globalThis.ZeroLatencySettingsAppUpdateCatalog;
  const controller = globalThis.ZeroLatencySettingsAppUpdateController?.create?.();

  globalThis.ZeroLatencySettingsAppUpdates = {
    initialize: (...args) => controller?.initialize?.(...args),
    normalizeVersion: versionApi.normalizeVersion,
    compareVersions: versionApi.compareVersions,
    buildUpgradeableCatalog: catalogApi.buildUpgradeableCatalog,
  };
})();
