(() => {
  function filterAndSortProviderModels(models, providerId, catalogModels = []) {
    if (globalThis.ZeroLatencySettingsAiModelProvider?.isLmStudioProvider?.(providerId)) {
      return filterAndSortLmStudioModels(models);
    }

    const catalogRankById = new Map(
      catalogModels.map((model, index) => [model.id, index])
    );
    const uniqueModels = [];
    const seenModelIds = new Set();

    for (const model of Array.isArray(models) ? models : []) {
      const normalizedModel = normalizeModelOption(model);
      if (!normalizedModel || seenModelIds.has(normalizedModel.id)) {
        continue;
      }

      seenModelIds.add(normalizedModel.id);
      uniqueModels.push(normalizedModel);
    }

    return uniqueModels.sort((left, right) => {
      const leftRank = catalogRankById.has(left.id)
        ? catalogRankById.get(left.id)
        : Number.MAX_SAFE_INTEGER;
      const rightRank = catalogRankById.has(right.id)
        ? catalogRankById.get(right.id)
        : Number.MAX_SAFE_INTEGER;

      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return String(left.label || left.id).localeCompare(String(right.label || right.id));
    });
  }

  function getCatalogModels(providerId) {
    const settingsApi = globalThis.ZeroLatencySettings;

    if (typeof settingsApi?.getAiProviderModels === "function") {
      return settingsApi.getAiProviderModels(providerId);
    }

    return [];
  }

  function normalizeModelOption(model) {
    if (!model || typeof model !== "object") {
      return null;
    }

    const id = typeof model.id === "string" ? model.id.trim() : "";
    if (!id) {
      return null;
    }

    const label =
      typeof model.label === "string" && model.label.trim()
        ? model.label.trim()
        : id;

    return {
      ...model,
      id,
      label,
    };
  }

  function filterAndSortLmStudioModels(models) {
    const seenModelIds = new Set();
    const uniqueModels = [];

    for (const model of Array.isArray(models) ? models : []) {
      const normalizedModel = normalizeModelOption(model);
      if (!normalizedModel || seenModelIds.has(normalizedModel.id)) {
        continue;
      }

      seenModelIds.add(normalizedModel.id);
      uniqueModels.push({
        ...normalizedModel,
        statusLabel:
          normalizedModel.statusLabel || (normalizedModel.loaded ? "loaded" : "not loaded"),
      });
    }

    return uniqueModels.sort((left, right) => {
      if (left.loaded !== right.loaded) {
        return left.loaded ? -1 : 1;
      }

      return String(left.label || left.id).localeCompare(String(right.label || right.id));
    });
  }

  globalThis.ZeroLatencySettingsAiModelFilters = {
    filterAndSortProviderModels,
    getCatalogModels,
    filterAndSortLmStudioModels,
  };
})();
