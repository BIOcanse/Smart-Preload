(() => {
  const SETTINGS_STORAGE_KEY = "userSettingsV1";
  const SETTINGS_STORAGE_VERSION = 2;
  const PRELOAD_RULE_CARD_IDS = ["perPagePreloadLimit"];
  const SORTABLE_CARD_IDS = [
    "highFrequencyRank",
    "frequencyRange",
  ];
  const RULE_CARD_IDS = [...PRELOAD_RULE_CARD_IDS, ...SORTABLE_CARD_IDS];
  const SORTABLE_OPERATOR_VALUES = ["disabled", "gt", "gte", "eq", "lte", "lt"];
  const SORTABLE_STATUS_VALUES = ["enabled", "disabled"];
  const RULE_OPERATOR_OPTIONS = [
    { value: "disabled", label: "禁用" },
    { value: "gt", label: ">" },
    { value: "gte", label: ">=" },
    { value: "eq", label: "=" },
    { value: "lte", label: "<=" },
    { value: "lt", label: "<" },
  ];
  const RULE_CARD_SCHEMA = {
    perPagePreloadLimit: {
      title: "每页预加载标签页限制 x",
      description: "强制上限规则。它始终在有序筛选链之外单独生效。",
      fields: [
        { key: "valueA", type: "number", min: 0, max: 9999, label: "值 A" },
        { key: "operatorA", type: "select", options: RULE_OPERATOR_OPTIONS, label: "比较 A" },
        { key: "tokenX", type: "token", text: "x", label: "x" },
        { key: "operatorB", type: "select", options: RULE_OPERATOR_OPTIONS, label: "比较 B" },
        { key: "valueC", type: "number", min: 0, max: 9999, label: "值 C" },
        { key: "status", type: "status-toggle", label: "状态" },
      ],
    },
    highFrequencyRank: {
      title: "预加载跳转频数排名符合 x 的高频网页",
      description: "用于表达按跳转排名筛选高频目标网页的规则条件。",
      fields: [
        { key: "valueA", type: "number", min: 0, max: 9999, label: "值 A" },
        { key: "operatorA", type: "select", options: RULE_OPERATOR_OPTIONS, label: "比较 A" },
        { key: "tokenX", type: "token", text: "x", label: "x" },
        { key: "operatorB", type: "select", options: RULE_OPERATOR_OPTIONS, label: "比较 B" },
        { key: "valueC", type: "number", min: 0, max: 9999, label: "值 C" },
        { key: "status", type: "status-toggle", label: "状态" },
      ],
    },
    frequencyRange: {
      title: "预加载跳转频数位于 x 的网页",
      description: "用于表达按跳转频数区间筛选候选网页的规则条件。",
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

  const DEFAULT_SETTINGS = {
    version: SETTINGS_STORAGE_VERSION,
    automaticDeviceTuning: true,
    tracking: {
      trackGoogleSearchPages: true,
    },
    preloading: {
      enabled: true,
      mode: "balanced",
      maxTabsPerSource: 3,
      crossSiteCurrentTabSwap: false,
    },
    preloadWindow: {
      watchdogEnabled: true,
      watchdogIntervalSeconds: 1,
      forceMinimize: true,
    },
    experiments: {
      idleWakeAggressive: false,
      pointerProximityPrediction: false,
      authStateWarmup: false,
    },
    layout: {
      sortableCards: {
        order: [...SORTABLE_CARD_IDS],
        items: {
          perPagePreloadLimit: {
            valueA: 0,
            operatorA: "disabled",
            valueB: 1,
            operatorB: "lte",
            valueC: 3,
            status: "enabled",
          },
          highFrequencyRank: {
            valueA: 5,
            operatorA: "lte",
            valueB: 1,
            operatorB: "gte",
            valueC: 0,
            status: "enabled",
          },
          frequencyRange: {
            valueA: 10,
            operatorA: "gte",
            valueB: 100,
            operatorB: "lte",
            valueC: 0,
            status: "enabled",
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
    normalized.version = SETTINGS_STORAGE_VERSION;
    normalized.preloading.mode = ["conservative", "balanced", "aggressive"].includes(
      normalized.preloading.mode
    )
      ? normalized.preloading.mode
      : DEFAULT_SETTINGS.preloading.mode;
    normalized.preloadWindow.watchdogIntervalSeconds = clamp(
      normalized.preloadWindow.watchdogIntervalSeconds,
      1,
      10,
      DEFAULT_SETTINGS.preloadWindow.watchdogIntervalSeconds
    );
    normalized.layout = normalizeLayoutSettings(normalized.layout);
    normalized.preloading.maxTabsPerSource = derivePreloadCapFromRuleCard(
      normalized.layout.sortableCards.items?.perPagePreloadLimit,
      normalized.preloading.maxTabsPerSource
    );
    return normalized;
  }

  function normalizeLayoutSettings(layoutSettings) {
    const normalizedLayout = mergeSettings(DEFAULT_SETTINGS.layout, layoutSettings);
    const sortableCards = normalizedLayout.sortableCards || {};
    const rawOrder = Array.isArray(sortableCards.order) ? sortableCards.order : [];
    const uniqueOrder = rawOrder.filter(
      (cardId, index) => SORTABLE_CARD_IDS.includes(cardId) && rawOrder.indexOf(cardId) === index
    );
    const completedOrder = [
      ...uniqueOrder,
      ...SORTABLE_CARD_IDS.filter((cardId) => !uniqueOrder.includes(cardId)),
    ];

    return {
      sortableCards: {
        order: completedOrder,
        items: normalizeSortableCardItems(sortableCards.items),
      },
    };
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

  function normalizeSortableOperator(value, fallback) {
    return SORTABLE_OPERATOR_VALUES.includes(value) ? value : fallback;
  }

  function normalizeSortableStatus(value, fallback) {
    return SORTABLE_STATUS_VALUES.includes(value) ? value : fallback;
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
    const fallbackValue = clamp(
      fallback,
      1,
      6,
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
      return clamp(normalizedCard.valueC, 1, 6, fallbackValue);
    }

    if (["gt", "gte", "eq"].includes(normalizedCard.operatorA)) {
      return clamp(normalizedCard.valueA, 1, 6, fallbackValue);
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

    return {
      ...normalized,
      detectedDeviceProfile: deviceProfile,
      preloading: {
        ...normalized.preloading,
        effectiveMaxTabsPerSource: Math.max(1, normalized.preloading.maxTabsPerSource),
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
    detectDeviceProfile,
    resolveEffectiveSettings,
    getNavigatorSnapshot,
    loadSettings,
    saveSettings,
  };
})();
