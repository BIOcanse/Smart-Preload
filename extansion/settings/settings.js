const settingsApi = globalThis.ZeroLatencySettings;
const settingsAiModels = globalThis.ZeroLatencySettingsAiModels;
const settingsAiModelControls = globalThis.ZeroLatencySettingsAiModelControls;
const settingsAppUpdates = globalThis.ZeroLatencySettingsAppUpdates;
const settingsUi = globalThis.ZeroLatencySettingsUi;
const settingsRuleCards = globalThis.ZeroLatencySettingsRuleCards;
const settingsHistoryDeletion = globalThis.ZeroLatencySettingsHistoryDeletion;
const settingsPerformanceWarning = globalThis.ZeroLatencySettingsPerformanceWarning;
const settingsNavigation = globalThis.ZeroLatencySettingsNavigation;
const i18n = globalThis.ZeroLatencyI18n;
const t = (key, substitutions = [], fallback = "") =>
  i18n?.t?.(key, substitutions, fallback) || fallback || key;

const formElements = {
  languageMode: document.getElementById("language-mode"),
  trackGoogleSearchPages: document.getElementById("track-google-search-pages"),
  excludeGoogleInternalPages: document.getElementById("exclude-google-internal-pages"),
  excludeHttpPages: document.getElementById("exclude-http-pages"),
  excludeLocalPages: document.getElementById("exclude-local-pages"),
  excludePrivateNetworkPages: document.getElementById("exclude-private-network-pages"),
  preloadingEnabled: document.getElementById("preloading-enabled"),
  interactionPreloadEnabled: document.getElementById("interaction-preload-enabled"),
  realPreloadEnabled: document.getElementById("real-preload-enabled"),
  ignoreWaterfallDynamicLinks: document.getElementById("ignore-waterfall-dynamic-links"),
  excludeIncognitoWindows: document.getElementById("exclude-incognito-windows"),
  proxySkipEnabled: document.getElementById("proxy-skip-enabled"),
  proxySkipMode: document.getElementById("proxy-skip-mode"),
  proxySkipRules: document.getElementById("proxy-skip-rules"),
  transitionWindowScope: document.getElementById("transition-window-scope"),
  transitionWindowScopeEnabled: document.getElementById("transition-window-scope-enabled"),
  schedulerTabTotalMin: document.getElementById("scheduler-tab-total-min"),
  schedulerTabTotalMax: document.getElementById("scheduler-tab-total-max"),
  schedulerTabHalfLifeTabs: document.getElementById("scheduler-tab-half-life-tabs"),
  schedulerNativeTotalMin: document.getElementById("scheduler-native-total-min"),
  schedulerNativeTotalMax: document.getElementById("scheduler-native-total-max"),
  schedulerNativeHalfLifeTabs: document.getElementById("scheduler-native-half-life-tabs"),
  schedulerAttentionPoolHours: document.getElementById("scheduler-attention-pool-hours"),
  schedulerAttentionSegmentSeconds: document.getElementById("scheduler-attention-segment-seconds"),
  schedulerAttentionMaxGapSeconds: document.getElementById("scheduler-attention-max-gap-seconds"),
  schedulerAttentionInputWindowSeconds: document.getElementById(
    "scheduler-attention-input-window-seconds"
  ),
  schedulerAttentionMediaWeight: document.getElementById("scheduler-attention-media-weight"),
  schedulerAttentionAudioWeight: document.getElementById("scheduler-attention-audio-weight"),
  aiPredictionProvider: document.getElementById("ai-prediction-provider"),
  aiPredictionModel: document.getElementById("ai-prediction-model"),
  aiProviderApiKey: document.getElementById("ai-provider-api-key"),
  aiProviderEndpoint: document.getElementById("ai-provider-endpoint"),
  aiPredictionEnabled: document.getElementById("ai-prediction-enabled"),
  crossSiteCurrentTabSwap: document.getElementById("cross-site-current-tab-swap"),
  watchdogEnabled: document.getElementById("watchdog-enabled"),
  watchdogIntervalSeconds: document.getElementById("watchdog-interval-seconds"),
  fullscreenPressurePolicy: document.getElementById("fullscreen-pressure-policy"),
  forceMinimize: document.getElementById("force-minimize"),
  idleWakeAggressive: document.getElementById("idle-wake-aggressive"),
  pointerProximityPrediction: document.getElementById("pointer-proximity-prediction"),
  authStateWarmup: document.getElementById("auth-state-warmup"),
  diagnosticsLoggingEnabled: document.getElementById("diagnostics-logging-enabled"),
};

const saveButton = document.getElementById("save-button");
const resetButton = document.getElementById("reset-button");
const aiPredictionMismatchWarningElement = document.getElementById("ai-prediction-mismatch-warning");
const PRELOAD_RULE_CARD_IDS =
  settingsApi.PRELOAD_RULE_CARD_IDS ?? [
    "nativePerPagePreloadLimit",
    "highWeightRank",
    "perPagePreloadLimit",
    "highWeightRankTab",
    "googleBookmarkRank",
  ];
const TRACKING_RULE_CARD_IDS = settingsApi.TRACKING_RULE_CARD_IDS ?? [];
const preloadRuleCardsListElement = document.getElementById("preload-rule-cards-list");
const trackingRuleCardsListElement = document.getElementById("tracking-rule-cards-list");

const watchdogIntervalRowElement = document.getElementById("watchdog-interval-row");
const transitionWindowScopeRowElement = document.getElementById("transition-window-scope-row");
const hiddenTabsSchedulerGroupElement = document.getElementById("scheduler-hidden-tabs-group");
const crossSiteCurrentTabSwapRowElement = document.getElementById("cross-site-current-tab-swap-row");
const footerStatusTitleElement = document.getElementById("footer-status-title");
const footerStatusTextElement = document.getElementById("footer-status-text");
const navStatusTextElement = document.getElementById("nav-status-text");
const RULE_CARD_SCHEMA = settingsApi.RULE_CARD_SCHEMA ?? {};

let savedSettings = settingsApi.cloneSettings(settingsApi.DEFAULT_SETTINGS);
let draftSettings = settingsApi.cloneSettings(settingsApi.DEFAULT_SETTINGS);
const aiControls = settingsAiModelControls?.create?.({
  elements: formElements,
  warningElement: aiPredictionMismatchWarningElement,
  settingsApi,
  modelLoader: settingsAiModels,
  translate: t,
  readFormSettings: () => readFormSettings(),
  setDraftSettings: (nextSettings) => {
    draftSettings = nextSettings;
  },
  updateComputedState: (nextSettings) => updateComputedState(nextSettings),
});

void initializeSettingsPage();

async function initializeSettingsPage() {
  await i18n?.initialize?.();
  refreshLocalizedUiText();
  populateTransitionWindowOptions();
  populateLanguageOptions();
  aiControls?.populateProviderOptions?.();
  bindUiEvents();
  settingsHistoryDeletion?.initialize?.({ setStatus, translate: t });
  settingsNavigation?.initialize?.();
  setStatus(t("commonLoading", [], "Loading"), t("settingsReadingLocalSettings", [], "Reading local extension settings."));

  try {
    savedSettings = await settingsApi.loadSettings(chrome.storage.local);
    draftSettings = settingsApi.cloneSettings(savedSettings);
    renderForm(draftSettings);
    settingsNavigation?.queueSync?.();
    settingsAppUpdates?.initialize?.({ setStatus });
    settingsPerformanceWarning?.initialize?.({
      translate: t,
      isRealPreloadEnabled: () => formElements.realPreloadEnabled.checked === true,
    });
    setStatus(t("commonReady", [], "Ready"), t("settingsNoUnsavedChanges", [], "No unsaved changes."));
  } catch (error) {
    console.error(error);
    setStatus(t("commonFailed", [], "Failed"), t("settingsCouldNotLoad", [], "Could not load settings from storage."));
  }
}

function refreshLocalizedUiText() {
  settingsApi.refreshLocalizedText?.();
  i18n?.applyDocument?.(document);
  settingsUi.compactInlineSettingDescriptions(document, { translate: t });
}

function populateLanguageOptions() {
  const options = Array.isArray(i18n?.LANGUAGE_OPTIONS) ? i18n.LANGUAGE_OPTIONS : [];

  formElements.languageMode.textContent = "";

  for (const optionSpec of options) {
    const option = document.createElement("option");
    option.value = String(optionSpec.value);
    option.textContent = t(optionSpec.labelKey, [], optionSpec.fallback);
    formElements.languageMode.append(option);
  }
}

function populateTransitionWindowOptions() {
  const options = Array.isArray(settingsApi.TRANSITION_WINDOW_OPTIONS)
    ? settingsApi.TRANSITION_WINDOW_OPTIONS
    : [];

  formElements.transitionWindowScope.textContent = "";

  for (const optionSpec of options) {
    const option = document.createElement("option");
    option.value = String(optionSpec.value);
    option.textContent = optionSpec.label;
    formElements.transitionWindowScope.append(option);
  }
}

function bindUiEvents() {
  for (const element of Object.values(formElements)) {
    if (!element) {
      continue;
    }

    element.addEventListener("change", handleFormChange);
    element.addEventListener("input", handleFormChange);
  }

  preloadRuleCardsListElement?.addEventListener("input", handleRuleCardInput);
  preloadRuleCardsListElement?.addEventListener("change", handleRuleCardInput);
  trackingRuleCardsListElement?.addEventListener("input", handleRuleCardInput);
  trackingRuleCardsListElement?.addEventListener("change", handleRuleCardInput);

  saveButton.addEventListener("click", async () => {
    await saveCurrentSettings();
  });

  resetButton.addEventListener("click", () => {
    void resetDraftSettings();
  });

}

async function resetDraftSettings() {
  draftSettings = settingsApi.cloneSettings(settingsApi.DEFAULT_SETTINGS);
  await applyLanguageModeToPage(draftSettings.appearance.languageMode);
  renderForm(draftSettings);
  if (isDirty()) {
    setDirtyStatus(t("settingsDefaultsRestored", [], "Defaults restored in the form. Save to apply."));
  } else {
    setStatus(t("commonReady", [], "Ready"), t("settingsNoUnsavedChanges", [], "No unsaved changes."));
  }
}

async function handleFormChange(event) {
  syncMutuallyExclusivePreloadModeControls(event?.target);

  if (event?.target === formElements.aiPredictionProvider) {
    aiControls?.syncProviderFieldsFromSettings?.(draftSettings);
  }

  draftSettings = readFormSettings();

  if (event?.target === formElements.languageMode) {
    await applyLanguageModeToPage(draftSettings.appearance.languageMode);
    renderForm(draftSettings);
  }

  if (isSchedulerFormElement(event?.target)) {
    syncSchedulerFieldsFromSettings(draftSettings);
  }
  if (
    event?.target === formElements.aiPredictionProvider ||
    event?.target === formElements.aiProviderApiKey ||
    event?.target === formElements.aiProviderEndpoint
  ) {
    void aiControls?.refreshOptionsForCurrentProvider?.();
  }
  if (
    event?.target === formElements.aiPredictionModel ||
    event?.target === formElements.aiPredictionEnabled
  ) {
    void aiControls?.ensureSelectedLmStudioModelLoaded?.(draftSettings);
  }
  if (event?.target !== formElements.languageMode) {
    renderRuleCards(draftSettings);
  }
  updateComputedState(draftSettings);
  aiControls?.syncMismatchWarning?.();
  settingsNavigation?.queueSync?.();

  if (isDirty()) {
    setDirtyStatus(t("settingsUnsavedReady", [], "Unsaved changes are ready to be applied."));
  } else {
    setStatus(t("commonReady", [], "Ready"), t("settingsNoUnsavedChanges", [], "No unsaved changes."));
  }
}

async function applyLanguageModeToPage(languageMode) {
  const normalizedLanguageMode =
    settingsApi.normalizeLanguageMode?.(languageMode) ||
    i18n?.normalizeLanguageMode?.(languageMode) ||
    "auto";
  await i18n?.setLanguageMode?.(normalizedLanguageMode);
  refreshLocalizedUiText();
  populateLanguageOptions();
  populateTransitionWindowOptions();
  aiControls?.populateProviderOptions?.();
}

function isSchedulerFormElement(element) {
  return (
    element === formElements.schedulerTabTotalMin ||
    element === formElements.schedulerTabTotalMax ||
    element === formElements.schedulerTabHalfLifeTabs ||
    element === formElements.schedulerNativeTotalMin ||
    element === formElements.schedulerNativeTotalMax ||
    element === formElements.schedulerNativeHalfLifeTabs ||
    element === formElements.schedulerAttentionPoolHours ||
    element === formElements.schedulerAttentionSegmentSeconds ||
    element === formElements.schedulerAttentionMaxGapSeconds ||
    element === formElements.schedulerAttentionInputWindowSeconds ||
    element === formElements.schedulerAttentionMediaWeight ||
    element === formElements.schedulerAttentionAudioWeight
  );
}

function readFormSettings() {
  const aiPredictionSettings = aiControls?.readFormAiPrediction?.(draftSettings) ??
    draftSettings.preloading?.aiPrediction ??
    settingsApi.DEFAULT_SETTINGS.preloading.aiPrediction;

  return settingsApi.normalizeStoredSettings({
    automaticDeviceTuning: draftSettings.automaticDeviceTuning,
    appearance: {
      languageMode: formElements.languageMode.value,
    },
    tracking: {
      trackGoogleSearchPages: formElements.trackGoogleSearchPages.checked,
      excludeGoogleInternalPages: formElements.excludeGoogleInternalPages.checked,
      excludeHttpPages: formElements.excludeHttpPages.checked,
      excludeLocalPages: formElements.excludeLocalPages.checked,
      excludePrivateNetworkPages: formElements.excludePrivateNetworkPages.checked,
    },
    preloading: {
      enabled: formElements.preloadingEnabled.checked,
      mode: draftSettings.preloading.mode,
      nativeMaxPreloadsPerSource: draftSettings.preloading.nativeMaxPreloadsPerSource,
      maxTabsPerSource: draftSettings.preloading.maxTabsPerSource,
      siteSelectionLimit: draftSettings.preloading.siteSelectionLimit,
      tabSiteSelectionLimit: draftSettings.preloading.tabSiteSelectionLimit,
      interactionPreloadEnabled: formElements.interactionPreloadEnabled.checked,
      realPreloadEnabled: formElements.realPreloadEnabled.checked,
      ignoreWaterfallDynamicLinks: formElements.ignoreWaterfallDynamicLinks.checked,
      excludeIncognitoWindows: formElements.excludeIncognitoWindows.checked,
      proxySkip: {
        enabled: formElements.proxySkipEnabled.checked,
        mode: formElements.proxySkipMode.value,
        rules: settingsApi.normalizeProxySkipRules?.(formElements.proxySkipRules.value) ?? [],
      },
      transitionWindowScope: {
        enabled: formElements.transitionWindowScopeEnabled.checked,
        windowKey: formElements.transitionWindowScope.value,
      },
      scheduler: readSchedulerSettingsFromForm(),
      aiPrediction: aiPredictionSettings,
    },
    preloadWindow: {
      watchdogEnabled: formElements.watchdogEnabled.checked,
      watchdogIntervalSeconds: Number(formElements.watchdogIntervalSeconds.value) || 1,
      fullscreenPressurePolicy: formElements.fullscreenPressurePolicy.value,
      forceMinimize: formElements.forceMinimize.checked,
    },
    experiments: {
      crossSiteCurrentTabSwap:
        formElements.realPreloadEnabled.checked === true &&
        formElements.crossSiteCurrentTabSwap.checked === true,
      idleWakeAggressive: formElements.idleWakeAggressive.checked,
      pointerProximityPrediction: formElements.pointerProximityPrediction.checked,
      authStateWarmup: formElements.authStateWarmup.checked,
    },
    diagnostics: {
      enabled: formElements.diagnosticsLoggingEnabled.checked,
    },
    layout: {
      ruleCards: {
        items: settingsApi.cloneSettings(draftSettings.layout.ruleCards.items),
      },
    },
  });
}

function renderForm(settings) {
  syncBaseControlsFromSettings(settings);
  renderRuleCards(settings);
  updateComputedState(settings);
  aiControls?.syncMismatchWarning?.();
  settingsNavigation?.queueSync?.();
}

function syncBaseControlsFromSettings(settings) {
  formElements.languageMode.value = settings.appearance?.languageMode || "auto";
  formElements.trackGoogleSearchPages.checked = settings.tracking.trackGoogleSearchPages;
  formElements.excludeGoogleInternalPages.checked = settings.tracking.excludeGoogleInternalPages;
  formElements.excludeHttpPages.checked = settings.tracking.excludeHttpPages !== false;
  formElements.excludeLocalPages.checked = settings.tracking.excludeLocalPages !== false;
  formElements.excludePrivateNetworkPages.checked =
    settings.tracking.excludePrivateNetworkPages !== false;
  formElements.preloadingEnabled.checked = settings.preloading.enabled;
  formElements.interactionPreloadEnabled.checked =
    settings.preloading.interactionPreloadEnabled !== false;
  formElements.realPreloadEnabled.checked =
    settingsApi.isRealPreloadEnabled?.(settings) === true;
  formElements.ignoreWaterfallDynamicLinks.checked =
    settings.preloading.ignoreWaterfallDynamicLinks;
  formElements.excludeIncognitoWindows.checked =
    settings.preloading.excludeIncognitoWindows !== false;
  const proxySkipSettings =
    settingsApi.normalizeProxySkipSettings?.(settings.preloading.proxySkip) ??
    settings.preloading.proxySkip ??
    {};
  formElements.proxySkipEnabled.checked = proxySkipSettings.enabled === true;
  formElements.proxySkipMode.value =
    settingsApi.normalizeProxySkipMode?.(proxySkipSettings.mode) || "blacklist";
  formElements.proxySkipRules.value = Array.isArray(proxySkipSettings.rules)
    ? proxySkipSettings.rules.join("\n")
    : "";
  formElements.transitionWindowScopeEnabled.checked =
    settings.preloading.transitionWindowScope.enabled;
  formElements.transitionWindowScope.value = settings.preloading.transitionWindowScope.windowKey;
  syncSchedulerFieldsFromSettings(settings);
  formElements.aiPredictionEnabled.checked = settings.preloading.aiPrediction.enabled;
  formElements.aiPredictionProvider.value = settings.preloading.aiPrediction.providerId;
  aiControls?.syncProviderFieldsFromSettings?.(settings);
  formElements.crossSiteCurrentTabSwap.checked =
    settingsApi.isRealPreloadEnabled?.(settings) === true &&
    settings.experiments.crossSiteCurrentTabSwap === true;
  formElements.watchdogEnabled.checked = settings.preloadWindow.watchdogEnabled;
  formElements.watchdogIntervalSeconds.value = String(
    settings.preloadWindow.watchdogIntervalSeconds
  );
  formElements.fullscreenPressurePolicy.value =
    settingsApi.normalizeFullscreenPressurePolicy?.(
      settings.preloadWindow.fullscreenPressurePolicy
    ) || "sleep";
  formElements.forceMinimize.checked = settings.preloadWindow.forceMinimize;
  formElements.idleWakeAggressive.checked = settings.experiments.idleWakeAggressive;
  formElements.pointerProximityPrediction.checked =
    settings.experiments.pointerProximityPrediction;
  formElements.authStateWarmup.checked = settings.experiments.authStateWarmup;
  formElements.diagnosticsLoggingEnabled.checked = settings.diagnostics?.enabled === true;
}

function readSchedulerSettingsFromForm() {
  return {
    nativeTotalMin: Number(formElements.schedulerNativeTotalMin.value),
    nativeTotalMax: Number(formElements.schedulerNativeTotalMax.value),
    nativeHalfLifeTabs: Number(formElements.schedulerNativeHalfLifeTabs.value),
    tabTotalMin: Number(formElements.schedulerTabTotalMin.value),
    tabTotalMax: Number(formElements.schedulerTabTotalMax.value),
    tabHalfLifeTabs: Number(formElements.schedulerTabHalfLifeTabs.value),
    attentionPoolHours: Number(formElements.schedulerAttentionPoolHours.value),
    attentionSegmentSeconds: Number(formElements.schedulerAttentionSegmentSeconds.value),
    attentionMaxObservableGapSeconds: Number(formElements.schedulerAttentionMaxGapSeconds.value),
    attentionInputWindowSeconds: Number(
      formElements.schedulerAttentionInputWindowSeconds.value
    ),
    attentionMediaPlaybackWeight: Number(formElements.schedulerAttentionMediaWeight.value),
    attentionAudioPlaybackWeight: Number(formElements.schedulerAttentionAudioWeight.value),
  };
}

function syncSchedulerFieldsFromSettings(settings) {
  const schedulerSettings =
    settings.preloading?.scheduler ?? settingsApi.DEFAULT_SETTINGS.preloading.scheduler;

  formElements.schedulerNativeTotalMin.value = String(schedulerSettings.nativeTotalMin);
  formElements.schedulerNativeTotalMax.value = String(schedulerSettings.nativeTotalMax);
  formElements.schedulerNativeHalfLifeTabs.value = String(schedulerSettings.nativeHalfLifeTabs);
  formElements.schedulerTabTotalMin.value = String(schedulerSettings.tabTotalMin);
  formElements.schedulerTabTotalMax.value = String(schedulerSettings.tabTotalMax);
  formElements.schedulerTabHalfLifeTabs.value = String(schedulerSettings.tabHalfLifeTabs);
  formElements.schedulerAttentionPoolHours.value = String(schedulerSettings.attentionPoolHours);
  formElements.schedulerAttentionSegmentSeconds.value = String(
    schedulerSettings.attentionSegmentSeconds
  );
  formElements.schedulerAttentionMaxGapSeconds.value = String(
    schedulerSettings.attentionMaxObservableGapSeconds
  );
  formElements.schedulerAttentionInputWindowSeconds.value = String(
    schedulerSettings.attentionInputWindowSeconds
  );
  formElements.schedulerAttentionMediaWeight.value = String(
    schedulerSettings.attentionMediaPlaybackWeight
  );
  formElements.schedulerAttentionAudioWeight.value = String(
    schedulerSettings.attentionAudioPlaybackWeight
  );
}

function syncMutuallyExclusivePreloadModeControls(target) {
  if (
    target === formElements.realPreloadEnabled &&
    formElements.realPreloadEnabled.checked !== true
  ) {
    formElements.crossSiteCurrentTabSwap.checked = false;
    return;
  }

  if (
    target === formElements.crossSiteCurrentTabSwap &&
    formElements.crossSiteCurrentTabSwap.checked === true
  ) {
    formElements.realPreloadEnabled.checked = true;
  }
}

function updateComputedState(settings) {
  const effectiveSettings = settingsApi.resolveEffectiveSettings(settings);
  const realPreloadEnabled =
    settingsApi.isRealPreloadEnabled?.(effectiveSettings) === true;

  watchdogIntervalRowElement.classList.toggle(
    "is-disabled",
    !effectiveSettings.preloadWindow.watchdogEnabled || !realPreloadEnabled
  );
  watchdogIntervalRowElement.classList.toggle("has-disabled-select", !realPreloadEnabled);
  formElements.watchdogIntervalSeconds.disabled =
    !effectiveSettings.preloadWindow.watchdogEnabled || !realPreloadEnabled;
  transitionWindowScopeRowElement.classList.toggle(
    "has-disabled-select",
    !effectiveSettings.preloading.transitionWindowScope.enabled
  );
  formElements.transitionWindowScope.disabled =
    !effectiveSettings.preloading.transitionWindowScope.enabled;
  crossSiteCurrentTabSwapRowElement?.classList.toggle("is-disabled", !realPreloadEnabled);
  formElements.crossSiteCurrentTabSwap.disabled = !realPreloadEnabled;
  hiddenTabsSchedulerGroupElement?.classList.toggle("is-disabled", !realPreloadEnabled);
  for (const element of [
    formElements.schedulerTabTotalMin,
    formElements.schedulerTabTotalMax,
    formElements.schedulerTabHalfLifeTabs,
    formElements.watchdogEnabled,
    formElements.fullscreenPressurePolicy,
    formElements.forceMinimize,
  ]) {
    if (element) {
      element.disabled = !realPreloadEnabled;
    }
  }
}

async function saveCurrentSettings() {
  draftSettings = readFormSettings();
  setStatus(t("commonSaving", [], "Saving"), t("settingsWritingLocalSettings", [], "Writing settings to local extension storage."));

  try {
    const storedSettings = await settingsApi.saveSettings(chrome.storage.local, draftSettings);
    savedSettings = storedSettings;
    draftSettings = settingsApi.cloneSettings(storedSettings);
    renderForm(draftSettings);
    void aiControls?.ensureSelectedLmStudioModelLoaded?.(draftSettings);
    setStatus(t("commonSaved", [], "Saved"), t("settingsWrittenSuccessfully", [], "Settings written successfully."));
  } catch (error) {
    console.error(error);
    setStatus(t("commonFailed", [], "Failed"), t("settingsCouldNotSave", [], "Could not save settings."));
  }
}

function isDirty() {
  return JSON.stringify(savedSettings) !== JSON.stringify(draftSettings);
}

function setDirtyStatus(message) {
  footerStatusTitleElement.textContent = t("commonUnsaved", [], "Unsaved");
  footerStatusTextElement.textContent = message;
  navStatusTextElement.textContent = t("commonUnsaved", [], "Unsaved");
  syncActionButtons();
}

function setStatus(title, text) {
  footerStatusTitleElement.textContent = title;
  footerStatusTextElement.textContent = text;
  navStatusTextElement.textContent = text;
  syncActionButtons();
}

function syncActionButtons() {
  const dirty = isDirty();
  saveButton.disabled = !dirty;
  resetButton.disabled = !dirty;
}

function renderRuleCards(settings) {
  renderRuleCardList(preloadRuleCardsListElement, PRELOAD_RULE_CARD_IDS, settings);
  renderRuleCardList(trackingRuleCardsListElement, TRACKING_RULE_CARD_IDS, settings);
}

function renderRuleCardList(container, cardIds, settings) {
  settingsRuleCards.renderRuleCardList({
    container,
    cardIds,
    settings,
    ruleCardSchema: RULE_CARD_SCHEMA,
    translate: t,
  });
}

function handleRuleCardInput(event) {
  const input = event.target.closest(
    "input[data-card-id][data-field-key], select[data-card-id][data-field-key]"
  );

  if (!input) {
    return;
  }

  const { cardId, fieldKey } = input.dataset;
  const cardSchema = RULE_CARD_SCHEMA[cardId];
  const fieldSchema = cardSchema?.fields.find((field) => field.key === fieldKey);

  if (!cardSchema || !fieldSchema) {
    return;
  }

  const nextValue =
    input.type === "checkbox"
      ? input.checked
        ? "enabled"
        : "disabled"
      : input.tagName === "SELECT"
        ? input.value
        : Number(input.value || 0);

  draftSettings = settingsApi.normalizeStoredSettings(
    updateRuleCardField(draftSettings, cardId, fieldKey, nextValue)
  );

  if (fieldSchema.type === "number") {
    input.value = String(draftSettings.layout.ruleCards.items[cardId][fieldKey]);
  }

  if (fieldSchema.type === "select") {
    renderRuleCards(draftSettings);
  }

  if (isDirty()) {
    setDirtyStatus(t("settingsUnsavedReady", [], "Unsaved changes are ready to be applied."));
  } else {
    setStatus(t("commonReady", [], "Ready"), t("settingsNoUnsavedChanges", [], "No unsaved changes."));
  }
}

function updateRuleCardField(source, cardId, fieldKey, value) {
  const nextState = settingsApi.cloneSettings(source);

  if (!nextState.layout?.ruleCards?.items?.[cardId]) {
    return nextState;
  }

  nextState.layout.ruleCards.items[cardId][fieldKey] = value;
  return nextState;
}
