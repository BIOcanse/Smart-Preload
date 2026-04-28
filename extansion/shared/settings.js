(() => {
  const SETTINGS_STORAGE_KEY = "userSettingsV1";
  const SETTINGS_STORAGE_VERSION = 10;
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
    { value: "total", label: "总量" },
    { value: "last365d", label: "一年内" },
    { value: "last30d", label: "一个月内" },
    { value: "last7d", label: "7天内" },
    { value: "last1d", label: "1天内" },
  ];
  const AI_MODEL_OPTIONS = [
    { value: "qwen3-0.6b", label: "Qwen3 0.6B", runtimeId: "ollama-runtime" },
    { value: "qwen3-1.7b", label: "Qwen3 1.7B", runtimeId: "ollama-runtime" },
    { value: "qwen3-4b", label: "Qwen3 4B", runtimeId: "ollama-runtime" },
    { value: "gemma4-e2b", label: "Gemma 4 E2B", runtimeId: "ollama-runtime" },
    { value: "gemma4-e4b", label: "Gemma 4 E4B", runtimeId: "ollama-runtime" },
  ];
  const AI_MODEL_VALUES = AI_MODEL_OPTIONS.map((option) => option.value);
  const AI_MODEL_RUNTIME_BY_ID = Object.fromEntries(
    AI_MODEL_OPTIONS.map((option) => [option.value, option.runtimeId])
  );
  const RULE_OPERATOR_OPTIONS = [
    { value: "disabled", label: "禁用" },
    { value: "gt", label: ">" },
    { value: "gte", label: ">=" },
    { value: "eq", label: "=" },
    { value: "lte", label: "<=" },
    { value: "lt", label: "<" },
  ];
  const RULE_CARD_SCHEMA = {
    nativePerPagePreloadLimit: {
      title: "原生预加载组的页面槽位上限 a",
      description:
        "适用于原生 `prefetch` / `prerender` 指令候选。它决定这一组最多能留下多少个页面候选进入最终执行。",
      fields: [
        { key: "valueA", type: "number", min: 0, max: 9999, label: "值 A" },
        { key: "operatorA", type: "select", options: RULE_OPERATOR_OPTIONS, label: "比较 A" },
        { key: "tokenX", type: "token", text: "a", label: "a" },
        { key: "operatorB", type: "select", options: RULE_OPERATOR_OPTIONS, label: "比较 B" },
        { key: "valueC", type: "number", min: 0, max: 9999, label: "值 C" },
        { key: "status", type: "status-toggle", label: "状态" },
      ],
    },
    perPagePreloadLimit: {
      title: "真实标签页预加载组的页面槽位上限 a",
      description:
        "适用于需要真实后台标签页的候选。它决定这一组最多能留下多少个页面候选进入最终执行。",
      fields: [
        { key: "valueA", type: "number", min: 0, max: 9999, label: "值 A" },
        { key: "operatorA", type: "select", options: RULE_OPERATOR_OPTIONS, label: "比较 A" },
        { key: "tokenX", type: "token", text: "a", label: "a" },
        { key: "operatorB", type: "select", options: RULE_OPERATOR_OPTIONS, label: "比较 B" },
        { key: "valueC", type: "number", min: 0, max: 9999, label: "值 C" },
        { key: "status", type: "status-toggle", label: "状态" },
      ],
    },
    highWeightRank: {
      title: "原生预加载组的高权重站点数量 x",
      description:
        "适用于原生 `prefetch` / `prerender` 指令候选。它决定这一组最多有多少个高权重站点进入站点分槽阶段。",
      fields: [
        { key: "valueA", type: "number", min: 0, max: 9999, label: "值 A" },
        { key: "operatorA", type: "select", options: RULE_OPERATOR_OPTIONS, label: "比较 A" },
        { key: "tokenX", type: "token", text: "x", label: "x" },
        { key: "operatorB", type: "select", options: RULE_OPERATOR_OPTIONS, label: "比较 B" },
        { key: "valueC", type: "number", min: 0, max: 9999, label: "值 C" },
        { key: "status", type: "status-toggle", label: "状态" },
      ],
    },
    highWeightRankTab: {
      title: "真实标签页预加载组的高权重站点数量 x",
      description:
        "适用于需要真实后台标签页的候选，包括跨站新标签预加载，以及开启当前标签页硬替换后改走 hidden-tab 的跨站候选。",
      fields: [
        { key: "valueA", type: "number", min: 0, max: 9999, label: "值 A" },
        { key: "operatorA", type: "select", options: RULE_OPERATOR_OPTIONS, label: "比较 A" },
        { key: "tokenX", type: "token", text: "x", label: "x" },
        { key: "operatorB", type: "select", options: RULE_OPERATOR_OPTIONS, label: "比较 B" },
        { key: "valueC", type: "number", min: 0, max: 9999, label: "值 C" },
        { key: "status", type: "status-toggle", label: "状态" },
      ],
    },
    weightRange: {
      title: "预加载权重位于 x 的网页",
      description: "用于表达按最终候选权重区间筛选候选网页的规则条件。",
      fields: [
        { key: "valueA", type: "number", min: 0, max: 9999, label: "值 A" },
        { key: "operatorA", type: "select", options: RULE_OPERATOR_OPTIONS, label: "比较 A" },
        { key: "tokenX", type: "token", text: "x", label: "x" },
        { key: "operatorB", type: "select", options: RULE_OPERATOR_OPTIONS, label: "比较 B" },
        { key: "valueC", type: "number", min: 0, max: 9999, label: "值 C" },
        { key: "status", type: "status-toggle", label: "状态" },
      ],
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
        modelId: "qwen3-0.6b",
      },
      modelManager: {
        selectedModelId: "qwen3-0.6b",
        downloadedModels: createDefaultAiDownloadedModels(),
        installedRuntimeIds: [],
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
    normalized.preloading.modelManager = normalizeAiModelManagerSettings(
      normalized.preloading.modelManager
    );
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

  function createDefaultAiDownloadedModels() {
    return Object.fromEntries(AI_MODEL_VALUES.map((modelId) => [modelId, false]));
  }

  function normalizeAiModelId(
    value,
    fallback = DEFAULT_SETTINGS.preloading.aiPrediction.modelId
  ) {
    return AI_MODEL_VALUES.includes(value) ? value : fallback;
  }

  function normalizeAiDownloadedModels(value) {
    const downloadedModels = createDefaultAiDownloadedModels();

    if (!isPlainObject(value)) {
      return downloadedModels;
    }

    for (const modelId of AI_MODEL_VALUES) {
      if (typeof value[modelId] === "boolean") {
        downloadedModels[modelId] = value[modelId];
      }
    }

    return downloadedModels;
  }

  function deriveInstalledAiRuntimeIds(downloadedModels) {
    const runtimeIds = new Set();

    for (const modelId of AI_MODEL_VALUES) {
      if (!downloadedModels[modelId]) {
        continue;
      }

      const runtimeId = AI_MODEL_RUNTIME_BY_ID[modelId];

      if (runtimeId) {
        runtimeIds.add(runtimeId);
      }
    }

    return Array.from(runtimeIds);
  }

  function normalizeAiPredictionSettings(value) {
    const mergedValue = mergeSettings(DEFAULT_SETTINGS.preloading.aiPrediction, value);

    return {
      enabled: Boolean(mergedValue.enabled),
      modelId: normalizeAiModelId(mergedValue.modelId),
    };
  }

  function normalizeAiModelManagerSettings(value) {
    const mergedValue = mergeSettings(DEFAULT_SETTINGS.preloading.modelManager, value);
    const downloadedModels = normalizeAiDownloadedModels(mergedValue.downloadedModels);

    return {
      selectedModelId: normalizeAiModelId(mergedValue.selectedModelId),
      downloadedModels,
      installedRuntimeIds: deriveInstalledAiRuntimeIds(downloadedModels),
    };
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
    let label = "Balanced";
    let preloadCap = 3;

    if (hardwareConcurrency >= 12 || deviceMemory >= 16) {
      id = "high-end";
      label = "High-end";
      preloadCap = 5;
    } else if (hardwareConcurrency >= 8 || deviceMemory >= 8) {
      id = "strong";
      label = "Strong";
      preloadCap = 4;
    } else if (hardwareConcurrency > 0 && hardwareConcurrency <= 4) {
      id = "constrained";
      label = "Constrained";
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
        effectiveAiPredictionModelDownloaded: Boolean(
          normalized.preloading.modelManager.downloadedModels?.[
            normalized.preloading.aiPrediction.modelId
          ]
        ),
      },
    };
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
    });

    return normalizeStoredSettings(stored[SETTINGS_STORAGE_KEY]);
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
    SETTINGS_STORAGE_VERSION,
    PRELOAD_RULE_CARD_IDS,
    SORTABLE_CARD_IDS,
    RULE_CARD_IDS,
    SORTABLE_OPERATOR_VALUES,
    SORTABLE_STATUS_VALUES,
    TRANSITION_WINDOW_VALUES,
    TRANSITION_WINDOW_OPTIONS,
    AI_MODEL_OPTIONS,
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
