(() => {
  const DEFAULT_MODEL_LIST_MODE = "recommended";
  const MODEL_LIST_MODE_ALL = "all";
  const MAX_RECOMMENDED_MODELS = 24;
  const TEXT_UNSUITABLE_HINTS = new Set([
    "audio",
    "banana",
    "deprecated",
    "embedding",
    "embeddings",
    "guard",
    "image",
    "imagen",
    "live",
    "lyria",
    "moderation",
    "music",
    "realtime",
    "rerank",
    "robotics",
    "safeguard",
    "shutdown",
    "speech",
    "transcription",
    "translate",
    "tts",
    "veo",
    "vision",
    "whisper",
  ]);
  const FAMILY_HINTS = [
    "gemini",
    "gpt",
    "claude",
    "deepseek",
    "qwen",
    "glm",
    "kimi",
    "moonshot",
    "grok",
    "llama",
    "mistral",
    "mixtral",
    "command",
  ];
  const TIER_SPECS = [
    { value: "flash-lite", rank: 10, sequences: [["flash", "lite"]] },
    { value: "lite", rank: 20, tokens: ["lite", "nano", "small", "tiny"] },
    { value: "fast", rank: 30, tokens: ["fast"] },
    { value: "mini", rank: 40, tokens: ["mini"] },
    { value: "haiku", rank: 50, tokens: ["haiku"] },
    { value: "flash", rank: 60, tokens: ["flash"] },
    { value: "plus", rank: 70, tokens: ["plus"] },
    { value: "chat", rank: 80, tokens: ["chat"] },
    { value: "pro", rank: 90, tokens: ["pro"] },
    { value: "sonnet", rank: 100, tokens: ["sonnet"] },
    { value: "opus", rank: 110, tokens: ["opus"] },
    { value: "max", rank: 120, tokens: ["max"] },
  ];

  function normalizeModelListMode(value) {
    return value === MODEL_LIST_MODE_ALL ? MODEL_LIST_MODE_ALL : DEFAULT_MODEL_LIST_MODE;
  }

  function selectModelsForListMode({
    models,
    mode,
    providerId,
    selectedModelId,
  } = {}) {
    const normalizedModels = Array.isArray(models) ? models : [];
    const normalizedMode = normalizeModelListMode(mode);

    if (normalizedMode === MODEL_LIST_MODE_ALL || String(providerId || "") === "lmstudio") {
      return normalizedModels;
    }

    return ensureSelectedModel(
      selectLatestRecommendedModels(normalizedModels, providerId),
      normalizedModels,
      selectedModelId
    );
  }

  function selectLatestRecommendedModels(models, providerId) {
    const bestByGroup = new Map();

    for (let index = 0; index < models.length; index += 1) {
      const model = models[index];
      const metadata = parseModelMetadata(model, providerId, index);

      if (!metadata) {
        continue;
      }

      const current = bestByGroup.get(metadata.groupKey);
      if (!current || compareCandidate(metadata, current) < 0) {
        bestByGroup.set(metadata.groupKey, metadata);
      }
    }

    const selected = Array.from(bestByGroup.values())
      .sort(compareRecommendedOrder)
      .slice(0, MAX_RECOMMENDED_MODELS)
      .map((metadata) => metadata.model);

    return selected.length > 0 ? selected : models.slice(0, Math.min(models.length, 8));
  }

  function ensureSelectedModel(displayModels, allModels, selectedModelId) {
    const normalizedSelectedModelId = String(selectedModelId || "").trim();

    if (!normalizedSelectedModelId) {
      return displayModels;
    }

    if (displayModels.some((model) => model.id === normalizedSelectedModelId)) {
      return displayModels;
    }

    const selectedModel = allModels.find((model) => model.id === normalizedSelectedModelId);
    return selectedModel ? [...displayModels, selectedModel] : displayModels;
  }

  function parseModelMetadata(model, providerId, sourceIndex) {
    const id = String(model?.id || "").trim();
    if (!id) {
      return null;
    }

    const text = `${id} ${model?.label || ""}`.toLowerCase();
    const tokens = tokenize(text);

    if (tokens.length === 0 || tokens.some((token) => TEXT_UNSUITABLE_HINTS.has(token))) {
      return null;
    }

    const tier = detectTier(tokens);
    if (!tier) {
      return null;
    }

    const familyKey = detectFamilyKey(id, tokens, providerId);
    const version = extractVersion(tokens);

    return {
      model,
      sourceIndex,
      familyKey,
      tier: tier.value,
      tierRank: tier.rank,
      groupKey: `${familyKey}:${tier.value}`,
      version,
      latestAlias: tokens.includes("latest"),
      previewRank: getPreviewRank(tokens),
    };
  }

  function tokenize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9.]+/gu, "-")
      .split("-")
      .map((token) => token.trim())
      .filter(Boolean);
  }

  function detectTier(tokens) {
    for (const spec of TIER_SPECS) {
      if (
        spec.sequences?.some((sequence) => hasTokenSequence(tokens, sequence)) ||
        spec.tokens?.some((token) => tokens.includes(token))
      ) {
        return spec;
      }
    }

    return null;
  }

  function hasTokenSequence(tokens, sequence) {
    const maxStart = tokens.length - sequence.length;

    for (let index = 0; index <= maxStart; index += 1) {
      if (sequence.every((token, offset) => tokens[index + offset] === token)) {
        return true;
      }
    }

    return false;
  }

  function detectFamilyKey(modelId, tokens, providerId) {
    const vendorPrefix = modelId.includes("/") ? modelId.split("/")[0] : "";
    const family =
      FAMILY_HINTS.find((hint) => tokens.some((token) => token.startsWith(hint))) ||
      tokens.find((token) => !isVersionToken(token)) ||
      "model";

    return `${providerId || "provider"}:${vendorPrefix}:${family}`;
  }

  function extractVersion(tokens) {
    const version = [];

    for (const token of tokens) {
      const match = token.match(/^v?(\d+(?:\.\d+)*)$/u);
      if (!match) {
        continue;
      }

      for (const part of match[1].split(".")) {
        version.push(Number(part));
      }
    }

    return version;
  }

  function isVersionToken(token) {
    return /^v?\d+(?:\.\d+)*$/u.test(token);
  }

  function getPreviewRank(tokens) {
    if (tokens.includes("experimental")) {
      return 2;
    }

    if (tokens.includes("preview")) {
      return 1;
    }

    return 0;
  }

  function compareCandidate(left, right) {
    const versionResult = compareVersionDescending(left.version, right.version);
    if (versionResult !== 0) {
      return versionResult;
    }

    if (left.latestAlias !== right.latestAlias) {
      return left.latestAlias ? -1 : 1;
    }

    if (left.previewRank !== right.previewRank) {
      return left.previewRank - right.previewRank;
    }

    return left.sourceIndex - right.sourceIndex;
  }

  function compareRecommendedOrder(left, right) {
    if (left.sourceIndex !== right.sourceIndex) {
      return left.sourceIndex - right.sourceIndex;
    }

    if (left.familyKey !== right.familyKey) {
      return left.familyKey.localeCompare(right.familyKey);
    }

    return left.tierRank - right.tierRank;
  }

  function compareVersionDescending(left, right) {
    const maxLength = Math.max(left.length, right.length);

    for (let index = 0; index < maxLength; index += 1) {
      const leftPart = left[index] ?? -1;
      const rightPart = right[index] ?? -1;

      if (leftPart !== rightPart) {
        return rightPart - leftPart;
      }
    }

    return 0;
  }

  globalThis.ZeroLatencySettingsAiModelRecommendations = {
    DEFAULT_MODEL_LIST_MODE,
    MODEL_LIST_MODE_ALL,
    normalizeModelListMode,
    selectModelsForListMode,
    selectLatestRecommendedModels,
    parseModelMetadata,
  };
})();
