(() => {
  function localize(key, fallback, substitutions = []) {
    if (globalThis.ZeroLatencyI18n?.t) {
      return globalThis.ZeroLatencyI18n.t(key, substitutions, fallback);
    }

    try {
      const message = globalThis.chrome?.i18n?.getMessage?.(key) || "";
      const template = message || fallback || key;
      const values = Array.isArray(substitutions) ? substitutions : [substitutions];
      return String(template).replace(/\{(\d+)\}/g, (match, indexText) => {
        const value = values[Number(indexText)];
        return value == null ? match : String(value);
      });
    } catch (_error) {
      return fallback || key;
    }
  }

  function createRuleFields(tokenText) {
    return [
      {
        key: "valueA",
        type: "number",
        min: 0,
        max: 9999,
        label: localize("ruleFieldValueA", "Value A"),
      },
      {
        key: "operatorA",
        type: "select",
        options: RULE_OPERATOR_OPTIONS,
        label: localize("ruleFieldCompareA", "Compare A"),
      },
      { key: "tokenX", type: "token", text: tokenText, label: tokenText },
      {
        key: "operatorB",
        type: "select",
        options: RULE_OPERATOR_OPTIONS,
        label: localize("ruleFieldCompareB", "Compare B"),
      },
      {
        key: "valueC",
        type: "number",
        min: 0,
        max: 9999,
        label: localize("ruleFieldValueC", "Value C"),
      },
      {
        key: "status",
        type: "status-toggle",
        label: localize("ruleFieldStatus", "Status"),
      },
    ];
  }

  const SETTINGS_STORAGE_KEY = "userSettingsV1";
  const AI_TEST_CONFIG_STORAGE_KEY = "aiTestConfigV1";
  const SETTINGS_STORAGE_VERSION = 14;
  const AI_MODEL_CATALOG = globalThis.ZeroLatencyAiModelCatalog ?? null;
  const PRELOAD_RULE_CARD_IDS = ["nativePerPagePreloadLimit", "perPagePreloadLimit"];
  const SORTABLE_CARD_IDS = [
    "highWeightRank",
    "highWeightRankTab",
    "weightRange",
  ];
  const RULE_CARD_IDS = [...PRELOAD_RULE_CARD_IDS, ...SORTABLE_CARD_IDS];
  const SORTABLE_OPERATOR_VALUES = ["disabled", "gt", "gte", "eq", "lte", "lt"];
  const SORTABLE_STATUS_VALUES = ["enabled", "disabled"];
  const TRANSITION_WINDOW_VALUES = ["total", "last365d", "last30d", "last7d", "last1d"];
  const TRANSITION_WINDOW_OPTIONS = [
    { value: "total", label: localize("transitionWindowTotal", "Total") },
    { value: "last365d", label: localize("transitionWindow365d", "Last year") },
    { value: "last30d", label: localize("transitionWindow30d", "Last month") },
    { value: "last7d", label: localize("transitionWindow7d", "Last 7 days") },
    { value: "last1d", label: localize("transitionWindow1d", "Last day") },
  ];
  const FALLBACK_AI_PROVIDER_OPTIONS = [
    {
      value: "openai",
      label: "ChatGPT / OpenAI",
      defaultModelId: "gpt-4.1-mini",
      endpointUrl: "https://api.openai.com/v1/chat/completions",
    },
    {
      value: "gemini",
      label: "Gemini",
      defaultModelId: "gemini-2.5-flash",
      endpointUrl:
        "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    },
    {
      value: "claude",
      label: "Claude",
      defaultModelId: "claude-3-5-haiku-latest",
      endpointUrl: "https://api.anthropic.com/v1/messages",
    },
    {
      value: "grok",
      label: "Grok",
      defaultModelId: "grok-3-mini",
      endpointUrl: "https://api.x.ai/v1/chat/completions",
    },
    {
      value: "deepseek",
      label: "DeepSeek",
      defaultModelId: "deepseek-v4-flash",
      endpointUrl: "https://api.deepseek.com/chat/completions",
    },
    {
      value: "qwen",
      label: "Qwen",
      defaultModelId: "qwen-plus",
      endpointUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    },
    {
      value: "glm",
      label: "GLM",
      defaultModelId: "glm-4.5-flash",
      endpointUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    },
    {
      value: "kimi",
      label: "Kimi",
      defaultModelId: "kimi-k2.5",
      endpointUrl: "https://api.moonshot.ai/v1/chat/completions",
    },
    {
      value: "openrouter",
      label: "OpenRouter",
      defaultModelId: "deepseek/deepseek-v4-flash",
      endpointUrl: "https://openrouter.ai/api/v1/chat/completions",
    },
    {
      value: "lmstudio",
      label: "LM Studio",
      defaultModelId: "local-model",
      endpointUrl: "http://127.0.0.1:1234/v1/chat/completions",
      apiKeyOptional: true,
    },
  ];
  const AI_PROVIDER_OPTIONS = Array.isArray(AI_MODEL_CATALOG?.providerOptions)
    ? AI_MODEL_CATALOG.providerOptions
    : FALLBACK_AI_PROVIDER_OPTIONS;
  const AI_PROVIDER_VALUES = AI_PROVIDER_OPTIONS.map((option) => option.value);
  const AI_PROVIDER_BY_ID = Object.fromEntries(
    AI_PROVIDER_OPTIONS.map((option) => [option.value, option])
  );
  const RULE_OPERATOR_OPTIONS = [
    { value: "disabled", label: localize("ruleOperatorDisabled", "Disabled") },
    { value: "gt", label: ">" },
    { value: "gte", label: ">=" },
    { value: "eq", label: "=" },
    { value: "lte", label: "<=" },
    { value: "lt", label: "<" },
  ];
  const RULE_CARD_SCHEMA = {
    nativePerPagePreloadLimit: {
      title: localize("ruleNativePerPageTitle", "Native preload group page slot cap a"),
      description: localize(
        "ruleNativePerPageDesc",
        "Applies to native `prefetch` / `prerender` candidates. It decides how many page candidates this group can keep for final execution."
      ),
      fields: createRuleFields("a"),
    },
    perPagePreloadLimit: {
      title: localize("ruleTabPerPageTitle", "Real-tab preload group page slot cap a"),
      description: localize(
        "ruleTabPerPageDesc",
        "Applies to candidates that need real background tabs. It decides how many page candidates this group can keep for final execution."
      ),
      fields: createRuleFields("a"),
    },
    highWeightRank: {
      title: localize("ruleNativeSiteTitle", "Native preload group high-weight site count x"),
      description: localize(
        "ruleNativeSiteDesc",
        "Applies to native `prefetch` / `prerender` candidates. It decides how many high-weight sites enter the site slot allocation stage."
      ),
      fields: createRuleFields("x"),
    },
    highWeightRankTab: {
      title: localize("ruleTabSiteTitle", "Real-tab preload group high-weight site count x"),
      description: localize(
        "ruleTabSiteDesc",
        "Applies to candidates that need real background tabs, including cross-site new-tab preload and current-tab hard-swap cross-site candidates routed to hidden-tab."
      ),
      fields: createRuleFields("x"),
    },
    weightRange: {
      title: localize("ruleWeightRangeTitle", "Pages with preload weight at x"),
      description: localize(
        "ruleWeightRangeDesc",
        "Expresses a rule condition that filters page candidates by final candidate weight range."
      ),
      fields: createRuleFields("x"),
    },
  };
  const LEGACY_RULE_CARD_DEFAULTS = {
    highWeightRank: {
      valueA: 5,
      operatorA: "lte",
      valueB: 1,
      operatorB: "gte",
      valueC: 0,
      status: "enabled",
    },
    weightRange: {
      valueA: 10,
      operatorA: "gte",
      valueB: 100,
      operatorB: "lte",
      valueC: 0,
      status: "enabled",
    },
  };

  const DEFAULT_SETTINGS = {
    version: SETTINGS_STORAGE_VERSION,
    automaticDeviceTuning: true,
    tracking: {
      trackGoogleSearchPages: true,
      excludeGoogleInternalPages: true,
    },
    preloading: {
      enabled: true,
      mode: "balanced",
      nativeMaxPreloadsPerSource: 7,
      maxTabsPerSource: 3,
      siteSelectionLimit: 5,
      tabSiteSelectionLimit: 3,
      ignoreWaterfallDynamicLinks: true,
      transitionWindowScope: {
        enabled: false,
        windowKey: "total",
      },
      aiPrediction: {
        enabled: false,
        providerId: "deepseek",
        modelId: "deepseek-v4-flash",
        apiKeys: createDefaultAiProviderMap(""),
        modelIds: createDefaultAiProviderModelIds(),
        endpointUrls: createDefaultAiProviderEndpointUrls(),
      },
    },
    preloadWindow: {
      watchdogEnabled: true,
      watchdogIntervalSeconds: 1,
      forceMinimize: true,
      systemLevelHiding: {
        support: {
          windows: true,
          mac: false,
          linux: false,
        },
        usable: false,
      },
    },
    experiments: {
      crossSiteCurrentTabSwap: true,
      idleWakeAggressive: false,
      pointerProximityPrediction: false,
      authStateWarmup: false,
    },
    diagnostics: {
      enabled: false,
    },
    layout: {
      sortableCards: {
        order: [...SORTABLE_CARD_IDS],
        items: {
          nativePerPagePreloadLimit: {
            valueA: 0,
            operatorA: "disabled",
            valueB: 1,
            operatorB: "lte",
            valueC: 7,
            status: "enabled",
          },
          perPagePreloadLimit: {
            valueA: 0,
            operatorA: "disabled",
            valueB: 1,
            operatorB: "lte",
            valueC: 3,
            status: "enabled",
          },
          highWeightRank: {
            valueA: 1,
            operatorA: "lte",
            valueB: 1,
            operatorB: "lte",
            valueC: 5,
            status: "enabled",
          },
          highWeightRankTab: {
            valueA: 1,
            operatorA: "lte",
            valueB: 1,
            operatorB: "lte",
            valueC: 3,
            status: "enabled",
          },
          weightRange: {
            valueA: 1,
            operatorA: "lte",
            valueB: 1,
            operatorB: "disabled",
            valueC: 0,
            status: "disabled",
          },
        },
      },
    },
  };

  const MODE_LIMITS = {
    conservative: 2,
    balanced: 3,
    aggressive: 5,
  };

  function cloneSettings(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function mergeSettings(base, override) {
    if (!isPlainObject(base)) {
      return cloneSettings(override);
    }

    const result = cloneSettings(base);

    if (!isPlainObject(override)) {
      return result;
    }

    for (const [key, value] of Object.entries(override)) {
      if (isPlainObject(value) && isPlainObject(result[key])) {
        result[key] = mergeSettings(result[key], value);
        continue;
      }

      result[key] = cloneSettings(value);
    }

    return result;
  }

  function normalizeStoredSettings(value) {
    const normalized = mergeSettings(DEFAULT_SETTINGS, value);
    const legacyCrossSiteCurrentTabSwap = isPlainObject(value?.preloading)
      ? value.preloading.crossSiteCurrentTabSwap
      : undefined;
    const hasExplicitExperimentCrossSiteSwap =
      isPlainObject(value?.experiments) &&
      typeof value.experiments.crossSiteCurrentTabSwap === "boolean";
    normalized.version = SETTINGS_STORAGE_VERSION;
    normalized.preloading.mode = ["conservative", "balanced", "aggressive"].includes(
      normalized.preloading.mode
    )
      ? normalized.preloading.mode
      : DEFAULT_SETTINGS.preloading.mode;
    normalized.preloading.transitionWindowScope = normalizeTransitionWindowScopeSettings(
      normalized.preloading.transitionWindowScope
    );
    normalized.preloading.aiPrediction = normalizeAiPredictionSettings(
      normalized.preloading.aiPrediction
    );
    migrateAiProviderCatalogDefaults(normalized, value);
    delete normalized.preloading.modelManager;
    normalized.preloading.ignoreWaterfallDynamicLinks =
      normalized.preloading.ignoreWaterfallDynamicLinks !== false;
    delete normalized.preloading.crossSiteCurrentTabSwap;
    normalized.preloadWindow.watchdogIntervalSeconds = clamp(
      normalized.preloadWindow.watchdogIntervalSeconds,
      1,
      10,
      DEFAULT_SETTINGS.preloadWindow.watchdogIntervalSeconds
    );
    normalized.experiments.crossSiteCurrentTabSwap =
      hasExplicitExperimentCrossSiteSwap
        ? Boolean(normalized.experiments.crossSiteCurrentTabSwap)
        : typeof legacyCrossSiteCurrentTabSwap === "boolean"
          ? legacyCrossSiteCurrentTabSwap
          : DEFAULT_SETTINGS.experiments.crossSiteCurrentTabSwap;
    normalized.diagnostics = {
      enabled: normalized.diagnostics?.enabled === true,
    };
    normalized.layout = normalizeLayoutSettings(normalized.layout);
    migrateLegacyRuleCardDefaults(normalized, value);
    migrateSplitSiteSelectionRuleCard(normalized, value);
    migrateSplitPreloadCapRuleCard(normalized, value);
    normalized.preloading.nativeMaxPreloadsPerSource = derivePreloadCapFromRuleCard(
      normalized.layout.sortableCards.items?.nativePerPagePreloadLimit,
      normalized.preloading.nativeMaxPreloadsPerSource
    );
    normalized.preloading.maxTabsPerSource = derivePreloadCapFromRuleCard(
      normalized.layout.sortableCards.items?.perPagePreloadLimit,
      normalized.preloading.maxTabsPerSource
    );
    normalized.preloading.siteSelectionLimit = deriveSiteSelectionLimitFromRuleCard(
      normalized.layout.sortableCards.items?.highWeightRank,
      normalized.preloading.siteSelectionLimit
    );
    normalized.preloading.siteSelectionLimit = clamp(
      normalized.preloading.siteSelectionLimit,
      1,
      20,
      DEFAULT_SETTINGS.preloading.siteSelectionLimit
    );
    normalized.preloading.tabSiteSelectionLimit = deriveSiteSelectionLimitFromRuleCard(
      normalized.layout.sortableCards.items?.highWeightRankTab,
      normalized.preloading.tabSiteSelectionLimit
    );
    normalized.preloading.tabSiteSelectionLimit = clamp(
      normalized.preloading.tabSiteSelectionLimit,
      1,
      20,
      DEFAULT_SETTINGS.preloading.tabSiteSelectionLimit
    );
    return normalized;
  }

  function normalizeLayoutSettings(layoutSettings) {
    const normalizedLayout = mergeSettings(DEFAULT_SETTINGS.layout, layoutSettings);
    const sortableCards = normalizedLayout.sortableCards || {};
    const rawOrder = Array.isArray(sortableCards.order) ? sortableCards.order : [];
    const normalizedOrder = rawOrder
      .map(normalizeRuleCardId)
      .filter(Boolean);
    const uniqueOrder = normalizedOrder.filter(
      (cardId, index) =>
        SORTABLE_CARD_IDS.includes(cardId) && normalizedOrder.indexOf(cardId) === index
    );
    const completedOrder = [
      ...uniqueOrder,
      ...SORTABLE_CARD_IDS.filter((cardId) => !uniqueOrder.includes(cardId)),
    ];

    return {
      sortableCards: {
        order: completedOrder,
        items: normalizeSortableCardItems(remapLegacyRuleCardItems(sortableCards.items)),
      },
    };
  }

  function migrateLegacyRuleCardDefaults(normalizedSettings, rawValue) {
    const rawVersion = Number(rawValue?.version);

    if (Number.isFinite(rawVersion) && rawVersion >= SETTINGS_STORAGE_VERSION) {
      return;
    }

    const rawItems = isPlainObject(rawValue?.layout?.sortableCards?.items)
      ? rawValue.layout.sortableCards.items
      : {};
    const nextItems = {
      ...(normalizedSettings.layout?.sortableCards?.items || {}),
    };
    let didMutate = false;

    for (const [legacyCardId, nextCardId] of Object.entries(LEGACY_RULE_CARD_ID_RENAMES)) {
      if (!matchesRuleCardState(rawItems[legacyCardId], LEGACY_RULE_CARD_DEFAULTS[nextCardId])) {
        continue;
      }

      nextItems[nextCardId] = cloneSettings(DEFAULT_SETTINGS.layout.sortableCards.items[nextCardId]);
      didMutate = true;
    }

    if (!didMutate) {
      return;
    }

    normalizedSettings.layout = {
      ...normalizedSettings.layout,
      sortableCards: {
        ...normalizedSettings.layout.sortableCards,
        items: nextItems,
      },
    };
  }

  function migrateSplitSiteSelectionRuleCard(normalizedSettings, rawValue) {
    const rawVersion = Number(rawValue?.version);

    if (Number.isFinite(rawVersion) && rawVersion >= SETTINGS_STORAGE_VERSION) {
      return;
    }

    const rawItems = isPlainObject(rawValue?.layout?.sortableCards?.items)
      ? remapLegacyRuleCardItems(rawValue.layout.sortableCards.items)
      : {};
    const sourceCardState = rawItems.highWeightRank;

    if (!isPlainObject(sourceCardState) || isPlainObject(rawItems.highWeightRankTab)) {
      return;
    }

    const currentOrder = Array.isArray(normalizedSettings.layout?.sortableCards?.order)
      ? normalizedSettings.layout.sortableCards.order
      : [];
    const nextOrder = currentOrder.filter((cardId) => cardId !== "highWeightRankTab");
    const nativeCardIndex = nextOrder.indexOf("highWeightRank");

    if (nativeCardIndex >= 0) {
      nextOrder.splice(nativeCardIndex + 1, 0, "highWeightRankTab");
    } else {
      nextOrder.push("highWeightRankTab");
    }

    normalizedSettings.layout = {
      ...normalizedSettings.layout,
      sortableCards: {
        ...normalizedSettings.layout.sortableCards,
        order: nextOrder,
        items: {
          ...normalizedSettings.layout.sortableCards.items,
          highWeightRankTab: mergeSettings(
            DEFAULT_SETTINGS.layout.sortableCards.items.highWeightRankTab,
            sourceCardState
          ),
        },
      },
    };
  }

  function migrateSplitPreloadCapRuleCard(normalizedSettings, rawValue) {
    const rawVersion = Number(rawValue?.version);

    if (Number.isFinite(rawVersion) && rawVersion >= SETTINGS_STORAGE_VERSION) {
      return;
    }

    const rawItems = isPlainObject(rawValue?.layout?.sortableCards?.items)
      ? remapLegacyRuleCardItems(rawValue.layout.sortableCards.items)
      : {};
    const sourceCardState = rawItems.perPagePreloadLimit;

    if (!isPlainObject(sourceCardState) || isPlainObject(rawItems.nativePerPagePreloadLimit)) {
      return;
    }

    normalizedSettings.layout = {
      ...normalizedSettings.layout,
      sortableCards: {
        ...normalizedSettings.layout.sortableCards,
        items: {
          ...normalizedSettings.layout.sortableCards.items,
          nativePerPagePreloadLimit: mergeSettings(
            DEFAULT_SETTINGS.layout.sortableCards.items.nativePerPagePreloadLimit,
            sourceCardState
          ),
        },
      },
    };
  }

  function matchesRuleCardState(rawValue, expectedValue) {
    if (!isPlainObject(rawValue) || !isPlainObject(expectedValue)) {
      return false;
    }

    return (
      Number(rawValue.valueA) === Number(expectedValue.valueA) &&
      rawValue.operatorA === expectedValue.operatorA &&
      Number(rawValue.valueB) === Number(expectedValue.valueB) &&
      rawValue.operatorB === expectedValue.operatorB &&
      Number(rawValue.valueC) === Number(expectedValue.valueC) &&
      rawValue.status === expectedValue.status
    );
  }

  function normalizeSortableCardItems(rawItems) {
    const nextItems = {};
    const providedItems = isPlainObject(rawItems) ? rawItems : {};

    for (const cardId of RULE_CARD_IDS) {
      const mergedItem = mergeSettings(
        DEFAULT_SETTINGS.layout.sortableCards.items[cardId],
        providedItems[cardId]
      );

      nextItems[cardId] = {
        valueA: clamp(mergedItem.valueA, 0, 9999, DEFAULT_SETTINGS.layout.sortableCards.items[cardId].valueA),
        operatorA: normalizeSortableOperator(
          mergedItem.operatorA,
          DEFAULT_SETTINGS.layout.sortableCards.items[cardId].operatorA
        ),
        valueB: clamp(mergedItem.valueB, 0, 9999, DEFAULT_SETTINGS.layout.sortableCards.items[cardId].valueB),
        operatorB: normalizeSortableOperator(
          mergedItem.operatorB,
          DEFAULT_SETTINGS.layout.sortableCards.items[cardId].operatorB
        ),
        valueC: clamp(mergedItem.valueC, 0, 9999, DEFAULT_SETTINGS.layout.sortableCards.items[cardId].valueC),
        status: normalizeSortableStatus(
          mergedItem.status,
          DEFAULT_SETTINGS.layout.sortableCards.items[cardId].status
        ),
      };
    }

    return nextItems;
  }

  function normalizeRuleCardId(cardId) {
    if (typeof cardId !== "string") {
      return null;
    }

    return LEGACY_RULE_CARD_ID_RENAMES[cardId] ?? cardId;
  }

  function remapLegacyRuleCardItems(rawItems) {
    if (!isPlainObject(rawItems)) {
      return {};
    }

    const nextItems = {};

    for (const [rawCardId, rawCardState] of Object.entries(rawItems)) {
      const normalizedCardId = normalizeRuleCardId(rawCardId);

      if (!normalizedCardId) {
        continue;
      }

      nextItems[normalizedCardId] = rawCardState;
    }

    return nextItems;
  }

  function normalizeSortableOperator(value, fallback) {
    return SORTABLE_OPERATOR_VALUES.includes(value) ? value : fallback;
  }

  function normalizeSortableStatus(value, fallback) {
    return SORTABLE_STATUS_VALUES.includes(value) ? value : fallback;
  }

  function normalizeTransitionWindowKey(value, fallback = DEFAULT_SETTINGS.preloading.transitionWindowScope.windowKey) {
    return TRANSITION_WINDOW_VALUES.includes(value) ? value : fallback;
  }

  function normalizeTransitionWindowScopeSettings(value) {
    const mergedValue = mergeSettings(DEFAULT_SETTINGS.preloading.transitionWindowScope, value);

    return {
      enabled: Boolean(mergedValue.enabled),
      windowKey: normalizeTransitionWindowKey(mergedValue.windowKey),
    };
  }

  function createDefaultAiProviderMap(defaultValue) {
    return Object.fromEntries(AI_PROVIDER_VALUES.map((providerId) => [providerId, defaultValue]));
  }

  function createDefaultAiProviderModelIds() {
    return Object.fromEntries(
      AI_PROVIDER_OPTIONS.map((provider) => [provider.value, provider.defaultModelId])
    );
  }

  function createDefaultAiProviderEndpointUrls() {
    return Object.fromEntries(
      AI_PROVIDER_OPTIONS.map((provider) => [provider.value, provider.endpointUrl])
    );
  }

  function normalizeAiProviderId(value, fallback = DEFAULT_SETTINGS.preloading.aiPrediction.providerId) {
    return AI_PROVIDER_VALUES.includes(value) ? value : fallback;
  }

  function normalizeAiProviderStringMap(value, fallbackMap) {
    const normalizedMap = cloneSettings(fallbackMap);

    if (!isPlainObject(value)) {
      return normalizedMap;
    }

    for (const providerId of AI_PROVIDER_VALUES) {
      const rawValue = value[providerId];

      if (typeof rawValue === "string") {
        normalizedMap[providerId] = rawValue.trim();
      }
    }

    return normalizedMap;
  }

  function getAiModelInfo(providerId, modelId) {
    const modelInfo = AI_MODEL_CATALOG?.getModel?.(providerId, modelId);
    return isPlainObject(modelInfo) ? cloneSettings(modelInfo) : null;
  }

  function getAiProviderModels(providerId) {
    const provider = AI_MODEL_CATALOG?.getProvider?.(providerId);
    return Array.isArray(provider?.models) ? cloneSettings(provider.models) : [];
  }

  function getAiRequestParams(providerId, modelId) {
    const requestParams = AI_MODEL_CATALOG?.getRequestParams?.(providerId, modelId);

    return isPlainObject(requestParams)
      ? cloneSettings(requestParams)
      : {
          temperature: 0.1,
          maxTokens: 512,
          responseFormatJson: true,
        };
  }

  function normalizeAiPredictionSettings(value) {
    const mergedValue = mergeSettings(DEFAULT_SETTINGS.preloading.aiPrediction, value);
    const providerId = normalizeAiProviderId(mergedValue.providerId);
    const modelIds = normalizeAiProviderStringMap(
      mergedValue.modelIds,
      DEFAULT_SETTINGS.preloading.aiPrediction.modelIds
    );
    const endpointUrls = normalizeAiProviderStringMap(
      mergedValue.endpointUrls,
      DEFAULT_SETTINGS.preloading.aiPrediction.endpointUrls
    );
    const apiKeys = normalizeAiProviderStringMap(
      mergedValue.apiKeys,
      DEFAULT_SETTINGS.preloading.aiPrediction.apiKeys
    );
    const legacyModelId =
      typeof mergedValue.modelId === "string" ? mergedValue.modelId.trim() : "";

    if (legacyModelId && !modelIds[providerId]) {
      modelIds[providerId] = legacyModelId;
    }

    return {
      enabled: Boolean(mergedValue.enabled),
      providerId,
      modelId: modelIds[providerId] || AI_PROVIDER_BY_ID[providerId]?.defaultModelId || "",
      apiKeys,
      modelIds,
      endpointUrls,
    };
  }

  function migrateAiProviderCatalogDefaults(normalizedSettings, rawValue) {
    const rawVersion = Number(rawValue?.version);

    if (Number.isFinite(rawVersion) && rawVersion >= SETTINGS_STORAGE_VERSION) {
      return;
    }

    const aiPrediction = normalizedSettings.preloading.aiPrediction;
    const kimiModelChanged = replaceStringMapValue(
      aiPrediction.modelIds,
      "kimi",
      "moonshot-v1-8k",
      AI_PROVIDER_BY_ID.kimi?.defaultModelId
    );
    const kimiEndpointChanged = replaceStringMapValue(
      aiPrediction.endpointUrls,
      "kimi",
      "https://api.moonshot.cn/v1/chat/completions",
      AI_PROVIDER_BY_ID.kimi?.endpointUrl
    );
    const glmModelChanged = replaceStringMapValue(
      aiPrediction.modelIds,
      "glm",
      "glm-4-flash",
      AI_PROVIDER_BY_ID.glm?.defaultModelId
    );
    const openRouterModelChanged = replaceStringMapValue(
      aiPrediction.modelIds,
      "openrouter",
      "deepseek/deepseek-chat-v3-0324:free",
      AI_PROVIDER_BY_ID.openrouter?.defaultModelId
    );
    const deepSeekModelChanged = replaceStringMapValue(
      aiPrediction.modelIds,
      "deepseek",
      "deepseek-chat",
      AI_PROVIDER_BY_ID.deepseek?.defaultModelId
    );

    if (aiPrediction.providerId === "kimi") {
      if (kimiModelChanged && aiPrediction.modelId === "moonshot-v1-8k") {
        aiPrediction.modelId = aiPrediction.modelIds.kimi;
      }

      if (kimiEndpointChanged && !aiPrediction.endpointUrls.kimi) {
        aiPrediction.endpointUrls.kimi = AI_PROVIDER_BY_ID.kimi?.endpointUrl || "";
      }
    }

    if (aiPrediction.providerId === "glm" && glmModelChanged && aiPrediction.modelId === "glm-4-flash") {
      aiPrediction.modelId = aiPrediction.modelIds.glm;
    }

    if (
      aiPrediction.providerId === "openrouter" &&
      openRouterModelChanged &&
      aiPrediction.modelId === "deepseek/deepseek-chat-v3-0324:free"
    ) {
      aiPrediction.modelId = aiPrediction.modelIds.openrouter;
    }

    if (
      aiPrediction.providerId === "deepseek" &&
      deepSeekModelChanged &&
      aiPrediction.modelId === "deepseek-chat"
    ) {
      aiPrediction.modelId = aiPrediction.modelIds.deepseek;
    }
  }

  function replaceStringMapValue(targetMap, key, oldValue, newValue) {
    if (!isPlainObject(targetMap) || !newValue || targetMap[key] !== oldValue) {
      return false;
    }

    targetMap[key] = newValue;
    return true;
  }

  function normalizeAiTestConfig(value) {
    if (!isPlainObject(value)) {
      return null;
    }

    const providerId = normalizeAiProviderId(value.providerId);
    const provider = AI_PROVIDER_BY_ID[providerId];
    const modelId =
      typeof value.modelId === "string" && value.modelId.trim()
        ? value.modelId.trim()
        : provider?.defaultModelId || "";
    const endpointUrl =
      typeof value.endpointUrl === "string" && value.endpointUrl.trim()
        ? value.endpointUrl.trim()
        : provider?.endpointUrl || "";
    const apiKey = typeof value.apiKey === "string" ? value.apiKey.trim() : "";

    if (!provider || !modelId || !endpointUrl) {
      return null;
    }

    return {
      enabled: value.enabled !== false,
      providerId,
      modelId,
      endpointUrl,
      apiKey,
    };
  }

  function applyAiTestConfig(settings, rawTestConfig) {
    const testConfig = normalizeAiTestConfig(rawTestConfig);

    if (!testConfig) {
      return settings;
    }

    const nextSettings = cloneSettings(settings);
    const aiPrediction = nextSettings.preloading.aiPrediction;
    aiPrediction.enabled = testConfig.enabled;
    aiPrediction.providerId = testConfig.providerId;
    aiPrediction.modelId = testConfig.modelId;
    aiPrediction.modelIds[testConfig.providerId] = testConfig.modelId;
    aiPrediction.endpointUrls[testConfig.providerId] = testConfig.endpointUrl;

    if (testConfig.apiKey) {
      aiPrediction.apiKeys[testConfig.providerId] = testConfig.apiKey;
    }

    return normalizeStoredSettings(nextSettings);
  }

  function isRuleCardEnabled(cardState) {
    return isPlainObject(cardState) && normalizeSortableStatus(cardState.status, "enabled") === "enabled";
  }

  function compareRuleValues(leftValue, operator, rightValue) {
    const normalizedOperator = normalizeSortableOperator(operator, "disabled");

    if (normalizedOperator === "disabled") {
      return true;
    }

    const numericLeft = Number(leftValue);
    const numericRight = Number(rightValue);

    if (!Number.isFinite(numericLeft) || !Number.isFinite(numericRight)) {
      return false;
    }

    switch (normalizedOperator) {
      case "gt":
        return numericLeft > numericRight;
      case "gte":
        return numericLeft >= numericRight;
      case "eq":
        return numericLeft === numericRight;
      case "lte":
        return numericLeft <= numericRight;
      case "lt":
        return numericLeft < numericRight;
      default:
        return true;
    }
  }

  function evaluateRuleCardMetric(cardState, metricValue) {
    if (!isRuleCardEnabled(cardState)) {
      return true;
    }

    const leftPassed =
      cardState.operatorA === "disabled"
        ? true
        : compareRuleValues(cardState.valueA, cardState.operatorA, metricValue);
    const rightPassed =
      cardState.operatorB === "disabled"
        ? true
        : compareRuleValues(metricValue, cardState.operatorB, cardState.valueC);

    return leftPassed && rightPassed;
  }

  function derivePreloadCapFromRuleCard(cardState, fallback) {
    const defaultFallback = Number.isFinite(Number(fallback))
      ? Number(fallback)
      : DEFAULT_SETTINGS.preloading.maxTabsPerSource;
    const fallbackValue = clamp(
      defaultFallback,
      1,
      20,
      DEFAULT_SETTINGS.preloading.maxTabsPerSource
    );

    if (!isPlainObject(cardState)) {
      return fallbackValue;
    }

    const normalizedCard = {
      valueA: clamp(cardState.valueA, 0, 9999, 0),
      operatorA: normalizeSortableOperator(cardState.operatorA, "disabled"),
      operatorB: normalizeSortableOperator(cardState.operatorB, "lte"),
      valueC: clamp(cardState.valueC, 0, 9999, fallbackValue),
      status: normalizeSortableStatus(cardState.status, "enabled"),
    };

    if (normalizedCard.status !== "enabled") {
      return fallbackValue;
    }

    if (["lt", "lte", "eq"].includes(normalizedCard.operatorB)) {
      return clamp(normalizedCard.valueC, 1, 20, fallbackValue);
    }

    if (["gt", "gte", "eq"].includes(normalizedCard.operatorA)) {
      return clamp(normalizedCard.valueA, 1, 20, fallbackValue);
    }

    return fallbackValue;
  }

  function deriveSiteSelectionLimitFromRuleCard(cardState, fallback) {
    const fallbackValue = clamp(
      fallback,
      1,
      20,
      DEFAULT_SETTINGS.preloading.siteSelectionLimit
    );

    if (!isPlainObject(cardState)) {
      return fallbackValue;
    }

    const normalizedCard = {
      valueA: clamp(cardState.valueA, 0, 9999, 0),
      operatorA: normalizeSortableOperator(cardState.operatorA, "disabled"),
      operatorB: normalizeSortableOperator(cardState.operatorB, "lte"),
      valueC: clamp(cardState.valueC, 0, 9999, fallbackValue),
      status: normalizeSortableStatus(cardState.status, "enabled"),
    };

    if (normalizedCard.status !== "enabled") {
      return fallbackValue;
    }

    if (["lt", "lte", "eq"].includes(normalizedCard.operatorB)) {
      return clamp(normalizedCard.valueC, 1, 20, fallbackValue);
    }

    if (["gt", "gte", "eq"].includes(normalizedCard.operatorA)) {
      return clamp(normalizedCard.valueA, 1, 20, fallbackValue);
    }

    return fallbackValue;
  }

  function clamp(value, min, max, fallback) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, Math.round(numericValue)));
  }

  function detectDeviceProfile(snapshot = getNavigatorSnapshot()) {
    const hardwareConcurrency = Number(snapshot.hardwareConcurrency) || 0;
    const deviceMemory = Number(snapshot.deviceMemory) || 0;
    let id = "balanced";
    let label = localize("deviceProfileBalanced", "Balanced");
    let preloadCap = 3;

    if (hardwareConcurrency >= 12 || deviceMemory >= 16) {
      id = "high-end";
      label = localize("deviceProfileHighEnd", "High-end");
      preloadCap = 5;
    } else if (hardwareConcurrency >= 8 || deviceMemory >= 8) {
      id = "strong";
      label = localize("deviceProfileStrong", "Strong");
      preloadCap = 4;
    } else if (hardwareConcurrency > 0 && hardwareConcurrency <= 4) {
      id = "constrained";
      label = localize("deviceProfileConstrained", "Constrained");
      preloadCap = 2;
    }

    return {
      id,
      label,
      preloadCap,
      hardwareConcurrency,
      deviceMemory,
    };
  }

  function resolveEffectiveSettings(userSettings, snapshot = getNavigatorSnapshot()) {
    const normalized = normalizeStoredSettings(userSettings);
    const deviceProfile = detectDeviceProfile(snapshot);
    const effectiveTransitionWindowKey = normalized.preloading.transitionWindowScope.enabled
      ? normalized.preloading.transitionWindowScope.windowKey
      : "total";

    return {
      ...normalized,
      detectedDeviceProfile: deviceProfile,
      preloading: {
        ...normalized.preloading,
        effectiveNativeMaxPreloadsPerSource: Math.max(
          1,
          normalized.preloading.nativeMaxPreloadsPerSource ??
            normalized.preloading.maxTabsPerSource
        ),
        effectiveTabMaxPreloadsPerSource: Math.max(1, normalized.preloading.maxTabsPerSource),
        effectiveMaxTabsPerSource: Math.max(1, normalized.preloading.maxTabsPerSource),
        effectiveSiteSelectionLimit: Math.max(
          1,
          normalized.preloading.siteSelectionLimit ??
            normalized.preloading.nativeMaxPreloadsPerSource ??
            normalized.preloading.maxTabsPerSource
        ),
        effectiveTabSiteSelectionLimit: Math.max(
          1,
          normalized.preloading.tabSiteSelectionLimit ??
            normalized.preloading.maxTabsPerSource ??
            normalized.preloading.siteSelectionLimit
        ),
        effectiveTransitionWindowKey,
        effectiveAiPredictionConfigured: isAiPredictionConfigured(
          normalized.preloading.aiPrediction
        ),
      },
    };
  }

  function isAiPredictionConfigured(aiPredictionSettings) {
    const providerId = normalizeAiProviderId(aiPredictionSettings?.providerId);
    const provider = AI_PROVIDER_BY_ID[providerId];
    const modelId =
      typeof aiPredictionSettings?.modelId === "string"
        ? aiPredictionSettings.modelId.trim()
        : "";
    const apiKey =
      typeof aiPredictionSettings?.apiKeys?.[providerId] === "string"
        ? aiPredictionSettings.apiKeys[providerId].trim()
        : "";
    const endpointUrl =
      typeof aiPredictionSettings?.endpointUrls?.[providerId] === "string"
        ? aiPredictionSettings.endpointUrls[providerId].trim()
        : "";

    if (!provider || !modelId || !endpointUrl) {
      return false;
    }

    return provider.apiKeyOptional === true || Boolean(apiKey);
  }

  function getNavigatorSnapshot() {
    const runtimeNavigator = globalThis.navigator || {};

    return {
      hardwareConcurrency: Number(runtimeNavigator.hardwareConcurrency) || 0,
      deviceMemory: Number(runtimeNavigator.deviceMemory) || 0,
      userAgent: runtimeNavigator.userAgent || "",
    };
  }

  async function loadSettings(storageArea) {
    const stored = await storageArea.get({
      [SETTINGS_STORAGE_KEY]: DEFAULT_SETTINGS,
      [AI_TEST_CONFIG_STORAGE_KEY]: null,
    });

    return applyAiTestConfig(
      normalizeStoredSettings(stored[SETTINGS_STORAGE_KEY]),
      globalThis.ZeroLatencyLocalAiTestConfig ?? stored[AI_TEST_CONFIG_STORAGE_KEY]
    );
  }

  async function saveSettings(storageArea, settings) {
    const normalized = normalizeStoredSettings(settings);
    await storageArea.set({
      [SETTINGS_STORAGE_KEY]: normalized,
    });
    return normalized;
  }

  globalThis.ZeroLatencySettings = {
    SETTINGS_STORAGE_KEY,
    AI_TEST_CONFIG_STORAGE_KEY,
    SETTINGS_STORAGE_VERSION,
    PRELOAD_RULE_CARD_IDS,
    SORTABLE_CARD_IDS,
    RULE_CARD_IDS,
    SORTABLE_OPERATOR_VALUES,
    SORTABLE_STATUS_VALUES,
    TRANSITION_WINDOW_VALUES,
    TRANSITION_WINDOW_OPTIONS,
    AI_PROVIDER_OPTIONS,
    AI_PROVIDER_VALUES,
    AI_PROVIDER_BY_ID,
    AI_MODEL_CATALOG,
    RULE_OPERATOR_OPTIONS,
    RULE_CARD_SCHEMA,
    DEFAULT_SETTINGS,
    MODE_LIMITS,
    cloneSettings,
    mergeSettings,
    normalizeStoredSettings,
    isRuleCardEnabled,
    compareRuleValues,
    evaluateRuleCardMetric,
    normalizeTransitionWindowKey,
    getAiModelInfo,
    getAiProviderModels,
    getAiRequestParams,
    isAiPredictionConfigured,
    detectDeviceProfile,
    resolveEffectiveSettings,
    getNavigatorSnapshot,
    loadSettings,
    saveSettings,
  };
})();
const LEGACY_RULE_CARD_ID_RENAMES = {
  highFrequencyRank: "highWeightRank",
  frequencyRange: "weightRange",
};
