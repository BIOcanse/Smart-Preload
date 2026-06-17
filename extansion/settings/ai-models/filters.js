(() => {
  const MAX_VISIBLE_MODEL_OPTIONS = 80;
  const BASIC_MODEL_HINTS = [
    "flash",
    "mini",
    "lite",
    "nano",
    "haiku",
    "small",
    "tiny",
    "fast",
    "cheap",
    "free",
  ];
  const NON_TEXT_MODEL_HINTS = [
    "audio",
    "embedding",
    "guard",
    "image",
    "moderation",
    "rerank",
    "safeguard",
    "speech",
    "tts",
    "vision",
    "whisper",
  ];
  const HEAVY_MODEL_HINTS = [
    "max",
    "opus",
    "pro",
    "reasoner",
    "reasoning",
    "sonnet",
    "thinking",
  ];

  function filterAndSortBasicModels(models, providerId, catalogModels = []) {
    if (globalThis.ZeroLatencySettingsAiModelProvider?.isLmStudioProvider?.(providerId)) {
      return filterAndSortLmStudioModels(models);
    }

    const catalogRankById = new Map(
      catalogModels.map((model, index) => [model.id, index])
    );
    const uniqueModels = [];
    const seenModelIds = new Set();

    for (const model of Array.isArray(models) ? models : []) {
      if (!model?.id || seenModelIds.has(model.id)) {
        continue;
      }

      if (!isBasicModel(model, providerId, catalogRankById)) {
        continue;
      }

      seenModelIds.add(model.id);
      uniqueModels.push(model);
    }

    return uniqueModels
      .sort((left, right) => {
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
      })
      .slice(0, MAX_VISIBLE_MODEL_OPTIONS);
  }

  function isBasicModel(model, providerId, catalogRankById) {
    const text = `${model.id || ""} ${model.label || ""}`.toLowerCase();

    if (!text.trim()) {
      return false;
    }

    if (NON_TEXT_MODEL_HINTS.some((hint) => text.includes(hint))) {
      return false;
    }

    const hasBasicHint = BASIC_MODEL_HINTS.some((hint) => text.includes(hint));
    const hasHeavyHint = HEAVY_MODEL_HINTS.some((hint) => text.includes(hint));

    if (hasHeavyHint && !hasBasicHint) {
      return false;
    }

    if (catalogRankById.has(model.id) && hasBasicHint) {
      return true;
    }

    if (providerId === "deepseek" && text.includes("deepseek-chat")) {
      return true;
    }

    if (hasBasicHint) {
      return true;
    }

    const sizeMatch = text.match(/(?:^|[^0-9.])(\d+(?:\.\d+)?)(b|m)(?:[^a-z]|$)/u);

    if (!sizeMatch) {
      return false;
    }

    const size = Number(sizeMatch[1]);
    const unit = sizeMatch[2];

    return unit === "m" || (unit === "b" && size <= 14);
  }

  function getCatalogModels(providerId) {
    const settingsApi = globalThis.ZeroLatencySettings;

    if (typeof settingsApi?.getAiProviderModels === "function") {
      return settingsApi.getAiProviderModels(providerId);
    }

    return [];
  }

  function filterAndSortLmStudioModels(models) {
    const seenModelIds = new Set();
    const uniqueModels = [];

    for (const model of Array.isArray(models) ? models : []) {
      if (!model?.id || seenModelIds.has(model.id)) {
        continue;
      }

      seenModelIds.add(model.id);
      uniqueModels.push({
        ...model,
        label: model.label || model.id,
        statusLabel: model.statusLabel || (model.loaded ? "loaded" : "not loaded"),
      });
    }

    return uniqueModels
      .sort((left, right) => {
        if (left.loaded !== right.loaded) {
          return left.loaded ? -1 : 1;
        }

        return String(left.label || left.id).localeCompare(String(right.label || right.id));
      })
      .slice(0, MAX_VISIBLE_MODEL_OPTIONS);
  }

  globalThis.ZeroLatencySettingsAiModelFilters = {
    MAX_VISIBLE_MODEL_OPTIONS,
    filterAndSortBasicModels,
    isBasicModel,
    getCatalogModels,
    filterAndSortLmStudioModels,
  };
})();
