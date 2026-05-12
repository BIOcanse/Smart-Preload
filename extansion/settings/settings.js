const settingsApi = globalThis.ZeroLatencySettings;
const settingsAiModels = globalThis.ZeroLatencySettingsAiModels;
const i18n = globalThis.ZeroLatencyI18n;
const t = (key, substitutions = [], fallback = "") =>
  i18n?.t?.(key, substitutions, fallback) || fallback || key;

i18n?.applyDocument?.(document);

const formElements = {
  automaticDeviceTuning: document.getElementById("automatic-device-tuning"),
  modeConservative: document.getElementById("mode-conservative"),
  modeBalanced: document.getElementById("mode-balanced"),
  modeAggressive: document.getElementById("mode-aggressive"),
  trackGoogleSearchPages: document.getElementById("track-google-search-pages"),
  excludeGoogleInternalPages: document.getElementById("exclude-google-internal-pages"),
  preloadingEnabled: document.getElementById("preloading-enabled"),
  ignoreWaterfallDynamicLinks: document.getElementById("ignore-waterfall-dynamic-links"),
  transitionWindowScope: document.getElementById("transition-window-scope"),
  transitionWindowScopeEnabled: document.getElementById("transition-window-scope-enabled"),
  aiPredictionProvider: document.getElementById("ai-prediction-provider"),
  aiPredictionModel: document.getElementById("ai-prediction-model"),
  aiProviderApiKey: document.getElementById("ai-provider-api-key"),
  aiProviderEndpoint: document.getElementById("ai-provider-endpoint"),
  aiPredictionEnabled: document.getElementById("ai-prediction-enabled"),
  crossSiteCurrentTabSwap: document.getElementById("cross-site-current-tab-swap"),
  watchdogEnabled: document.getElementById("watchdog-enabled"),
  watchdogIntervalSeconds: document.getElementById("watchdog-interval-seconds"),
  forceMinimize: document.getElementById("force-minimize"),
  idleWakeAggressive: document.getElementById("idle-wake-aggressive"),
  pointerProximityPrediction: document.getElementById("pointer-proximity-prediction"),
  authStateWarmup: document.getElementById("auth-state-warmup"),
  diagnosticsLoggingEnabled: document.getElementById("diagnostics-logging-enabled"),
};

const saveButton = document.getElementById("save-button");
const resetButton = document.getElementById("reset-button");
const navButtons = Array.from(document.querySelectorAll(".settings-nav-item"));
const aiPredictionMismatchWarningElement = document.getElementById("ai-prediction-mismatch-warning");
const PRELOAD_RULE_CARD_IDS =
  settingsApi.PRELOAD_RULE_CARD_IDS ?? [
    "nativePerPagePreloadLimit",
    "highWeightRank",
    "perPagePreloadLimit",
    "highWeightRankTab",
  ];
const TRACKING_RULE_CARD_IDS =
  settingsApi.TRACKING_RULE_CARD_IDS ?? ["googleBookmarkRank"];
const NAV_SECTION_IDS = ["overview", "tracking", "preload", "experiments"];
const NAV_SECTION_GROUPS = {
  overview: ["overview", "overview-panel"],
  tracking: ["tracking"],
  preload: ["preload"],
  experiments: ["experiments"],
};
const preloadRuleCardsListElement = document.getElementById("preload-rule-cards-list");
const trackingRuleCardsListElement = document.getElementById("tracking-rule-cards-list");

const deviceProfileLabelElement = document.getElementById("device-profile-label");
const deviceProfileMetaElement = document.getElementById("device-profile-meta");
const effectivePreloadCapElement = document.getElementById("effective-preload-cap");
const effectivePreloadMetaElement = document.getElementById("effective-preload-meta");
const watchdogSummaryElement = document.getElementById("watchdog-summary");
const watchdogMetaElement = document.getElementById("watchdog-meta");
const nativeAppStatusElement = document.getElementById("native-app-status");
const nativeAppMetaElement = document.getElementById("native-app-meta");
const watchdogIntervalRowElement = document.getElementById("watchdog-interval-row");
const transitionWindowScopeRowElement = document.getElementById("transition-window-scope-row");
const footerStatusTitleElement = document.getElementById("footer-status-title");
const footerStatusTextElement = document.getElementById("footer-status-text");
const navStatusTextElement = document.getElementById("nav-status-text");
const RULE_CARD_SCHEMA = settingsApi.RULE_CARD_SCHEMA ?? {};

let savedSettings = settingsApi.cloneSettings(settingsApi.DEFAULT_SETTINGS);
let draftSettings = settingsApi.cloneSettings(settingsApi.DEFAULT_SETTINGS);
let pendingNavSyncFrame = null;
let currentFeatureSupport = {};
let aiModelOptionsRequestId = 0;
let pendingLmStudioModelLoadId = "";

void initializeSettingsPage();

async function initializeSettingsPage() {
  populateTransitionWindowOptions();
  populateAiProviderOptions();
  bindUiEvents();
  setStatus(t("commonLoading", [], "Loading"), t("settingsReadingLocalSettings", [], "Reading local extension settings."));

  try {
    savedSettings = await settingsApi.loadSettings(chrome.storage.local);
    draftSettings = settingsApi.cloneSettings(savedSettings);
    renderForm(draftSettings);
    queueNavScrollSync();
    setStatus(t("commonReady", [], "Ready"), t("settingsNoUnsavedChanges", [], "No unsaved changes."));
    await fetchAndRenderFeatureSupport();
  } catch (error) {
    console.error(error);
    setStatus(t("commonFailed", [], "Failed"), t("settingsCouldNotLoad", [], "Could not load settings from storage."));
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

function populateAiProviderOptions() {
  const options = Array.isArray(settingsApi.AI_PROVIDER_OPTIONS)
    ? settingsApi.AI_PROVIDER_OPTIONS
    : [];

  formElements.aiPredictionProvider.textContent = "";

  for (const optionSpec of options) {
    const option = document.createElement("option");
    option.value = String(optionSpec.value);
    option.textContent = optionSpec.label;
    formElements.aiPredictionProvider.append(option);
  }
}

function bindUiEvents() {
  for (const element of Object.values(formElements)) {
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
    draftSettings = settingsApi.cloneSettings(settingsApi.DEFAULT_SETTINGS);
    renderForm(draftSettings);
    if (isDirty()) {
      setDirtyStatus(t("settingsDefaultsRestored", [], "Defaults restored in the form. Save to apply."));
    } else {
      setStatus(t("commonReady", [], "Ready"), t("settingsNoUnsavedChanges", [], "No unsaved changes."));
    }
  });

  for (const button of navButtons) {
    button.addEventListener("click", () => {
      const targetId = button.dataset.sectionTarget;
      activateNavButton(targetId);
      scrollToNavSection(targetId);
    });
  }

  window.addEventListener("scroll", syncNavForScrollPosition, {
    passive: true,
  });
  window.addEventListener("resize", queueNavScrollSync);

}

async function handleFormChange(event) {
  if (event?.target === formElements.aiPredictionProvider) {
    syncAiProviderFieldsFromSettings(draftSettings);
  }

  draftSettings = readFormSettings();
  if (
    event?.target === formElements.aiPredictionProvider ||
    event?.target === formElements.aiProviderApiKey ||
    event?.target === formElements.aiProviderEndpoint
  ) {
    void refreshAiModelOptionsForCurrentProvider();
  }
  if (
    event?.target === formElements.aiPredictionModel ||
    event?.target === formElements.aiPredictionEnabled
  ) {
    void ensureSelectedLmStudioModelLoadedFromSettings(draftSettings);
  }
  renderRuleCards(draftSettings);
  updateComputedState(draftSettings);
  syncAiPredictionMismatchWarning();
  queueNavScrollSync();

  if (isDirty()) {
    setDirtyStatus(t("settingsUnsavedReady", [], "Unsaved changes are ready to be applied."));
  } else {
    setStatus(t("commonReady", [], "Ready"), t("settingsNoUnsavedChanges", [], "No unsaved changes."));
  }
}

function readFormSettings() {
  let mode = "balanced";

  if (formElements.modeConservative.checked) {
    mode = "conservative";
  } else if (formElements.modeAggressive.checked) {
    mode = "aggressive";
  }

  const aiProviderId = formElements.aiPredictionProvider.value;
  const aiProvider = settingsApi.AI_PROVIDER_BY_ID?.[aiProviderId] ?? {};
  const aiProviderIsLmStudio = isLmStudioProvider(aiProviderId);
  const aiApiKeys = {
    ...(draftSettings.preloading?.aiPrediction?.apiKeys ?? {}),
    [aiProviderId]: aiProviderIsLmStudio ? "" : formElements.aiProviderApiKey.value.trim(),
  };
  const aiModelIds = {
    ...(draftSettings.preloading?.aiPrediction?.modelIds ?? {}),
    [aiProviderId]: formElements.aiPredictionModel.value.trim(),
  };
  const aiEndpointUrls = {
    ...(draftSettings.preloading?.aiPrediction?.endpointUrls ?? {}),
    [aiProviderId]: aiProviderIsLmStudio
      ? aiProvider.endpointUrl || globalThis.ZeroLatencyLmStudio?.CHAT_COMPLETIONS_URL || ""
      : formElements.aiProviderEndpoint.value.trim(),
  };

  return settingsApi.normalizeStoredSettings({
    automaticDeviceTuning: formElements.automaticDeviceTuning.checked,
    tracking: {
      trackGoogleSearchPages: formElements.trackGoogleSearchPages.checked,
      excludeGoogleInternalPages: formElements.excludeGoogleInternalPages.checked,
    },
    preloading: {
      enabled: formElements.preloadingEnabled.checked,
      mode,
      nativeMaxPreloadsPerSource: draftSettings.preloading.nativeMaxPreloadsPerSource,
      maxTabsPerSource: draftSettings.preloading.maxTabsPerSource,
      siteSelectionLimit: draftSettings.preloading.siteSelectionLimit,
      tabSiteSelectionLimit: draftSettings.preloading.tabSiteSelectionLimit,
      ignoreWaterfallDynamicLinks: formElements.ignoreWaterfallDynamicLinks.checked,
      transitionWindowScope: {
        enabled: formElements.transitionWindowScopeEnabled.checked,
        windowKey: formElements.transitionWindowScope.value,
      },
      aiPrediction: {
        enabled: formElements.aiPredictionEnabled.checked,
        providerId: aiProviderId,
        modelId: aiModelIds[aiProviderId],
        apiKeys: aiApiKeys,
        modelIds: aiModelIds,
        endpointUrls: aiEndpointUrls,
      },
    },
    preloadWindow: {
      watchdogEnabled: formElements.watchdogEnabled.checked,
      watchdogIntervalSeconds: Number(formElements.watchdogIntervalSeconds.value) || 1,
      forceMinimize: formElements.forceMinimize.checked,
    },
    experiments: {
      crossSiteCurrentTabSwap: formElements.crossSiteCurrentTabSwap.checked,
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
  syncAiPredictionMismatchWarning();
  queueNavScrollSync();
}

function syncBaseControlsFromSettings(settings) {
  formElements.automaticDeviceTuning.checked = settings.automaticDeviceTuning;
  formElements.modeConservative.checked = settings.preloading.mode === "conservative";
  formElements.modeBalanced.checked = settings.preloading.mode === "balanced";
  formElements.modeAggressive.checked = settings.preloading.mode === "aggressive";
  formElements.trackGoogleSearchPages.checked = settings.tracking.trackGoogleSearchPages;
  formElements.excludeGoogleInternalPages.checked = settings.tracking.excludeGoogleInternalPages;
  formElements.preloadingEnabled.checked = settings.preloading.enabled;
  formElements.ignoreWaterfallDynamicLinks.checked =
    settings.preloading.ignoreWaterfallDynamicLinks;
  formElements.transitionWindowScopeEnabled.checked =
    settings.preloading.transitionWindowScope.enabled;
  formElements.transitionWindowScope.value = settings.preloading.transitionWindowScope.windowKey;
  formElements.aiPredictionEnabled.checked = settings.preloading.aiPrediction.enabled;
  formElements.aiPredictionProvider.value = settings.preloading.aiPrediction.providerId;
  syncAiProviderFieldsFromSettings(settings);
  formElements.crossSiteCurrentTabSwap.checked = settings.experiments.crossSiteCurrentTabSwap;
  formElements.watchdogEnabled.checked = settings.preloadWindow.watchdogEnabled;
  formElements.watchdogIntervalSeconds.value = String(
    settings.preloadWindow.watchdogIntervalSeconds
  );
  formElements.forceMinimize.checked = settings.preloadWindow.forceMinimize;
  formElements.idleWakeAggressive.checked = settings.experiments.idleWakeAggressive;
  formElements.pointerProximityPrediction.checked =
    settings.experiments.pointerProximityPrediction;
  formElements.authStateWarmup.checked = settings.experiments.authStateWarmup;
  formElements.diagnosticsLoggingEnabled.checked = settings.diagnostics?.enabled === true;
}

function syncAiProviderFieldsFromSettings(settings) {
  const aiPrediction = settings.preloading?.aiPrediction ?? {};
  const providerId = formElements.aiPredictionProvider.value || aiPrediction.providerId;
  const provider =
    settingsApi.AI_PROVIDER_BY_ID?.[providerId] ??
    settingsApi.AI_PROVIDER_OPTIONS?.[0] ??
    {};
  const providerIsLmStudio = isLmStudioProvider(providerId);
  const modelId =
    aiPrediction.modelIds?.[providerId] || provider.defaultModelId || aiPrediction.modelId || "";
  const apiKey = providerIsLmStudio ? "" : aiPrediction.apiKeys?.[providerId] || "";
  const endpointUrl = providerIsLmStudio
    ? provider.endpointUrl || globalThis.ZeroLatencyLmStudio?.CHAT_COMPLETIONS_URL || ""
    : aiPrediction.endpointUrls?.[providerId] || provider.endpointUrl || "";
  renderAiModelSelectOptions({
    providerId,
    selectedModelId: modelId,
    models: getCuratedAiModelOptions(providerId),
    disabled: !apiKey && provider.apiKeyOptional !== true,
    placeholder:
      !apiKey && provider.apiKeyOptional !== true
        ? t("settingsAiEnterKeyToLoadModels", [], "Enter an API key to load models")
        : t("settingsAiLoadingModels", [], "Loading supported models..."),
  });
  formElements.aiProviderApiKey.value = apiKey;
  formElements.aiProviderEndpoint.value = endpointUrl;
  formElements.aiProviderApiKey.disabled = providerIsLmStudio;
  formElements.aiProviderEndpoint.disabled = providerIsLmStudio;
  formElements.aiProviderApiKey.placeholder =
    providerIsLmStudio
      ? t("settingsAiLmStudioKeyIgnoredPlaceholder", [], "Ignored for LM Studio")
      : provider.apiKeyOptional === true
      ? t("settingsAiKeyOptionalPlaceholder", [], "Optional for local compatible endpoints")
      : t("settingsAiKeyRequiredPlaceholder", [], "Required");
  void refreshAiModelOptions({
    providerId,
    selectedModelId: modelId,
    apiKey,
    endpointUrl,
  });
}

function getCuratedAiModelOptions(providerId) {
  return typeof settingsApi.getAiProviderModels === "function"
    ? settingsApi.getAiProviderModels(providerId)
    : [];
}

async function refreshAiModelOptionsForCurrentProvider() {
  const providerId = String(formElements.aiPredictionProvider.value || "");
  const provider = settingsApi.AI_PROVIDER_BY_ID?.[providerId] ?? {};
  const providerIsLmStudio = isLmStudioProvider(providerId);
  const selectedModelId = String(formElements.aiPredictionModel.value || "").trim();
  const apiKey = providerIsLmStudio
    ? ""
    : String(formElements.aiProviderApiKey.value || "").trim();
  const endpointUrl = providerIsLmStudio
    ? provider.endpointUrl || globalThis.ZeroLatencyLmStudio?.CHAT_COMPLETIONS_URL || ""
    : String(formElements.aiProviderEndpoint.value || "").trim();
  await refreshAiModelOptions({
    providerId,
    selectedModelId,
    apiKey,
    endpointUrl,
  });
}

async function refreshAiModelOptions({ providerId, selectedModelId, apiKey, endpointUrl }) {
  const provider = settingsApi.AI_PROVIDER_BY_ID?.[providerId];
  const requestId = ++aiModelOptionsRequestId;

  if (!provider) {
    renderAiModelSelectOptions({
      providerId,
      selectedModelId: "",
      models: [],
      disabled: true,
      placeholder: t("settingsAiSelectProviderFirst", [], "Select a provider first"),
    });
    return;
  }

  if (!apiKey && provider.apiKeyOptional !== true) {
    renderAiModelSelectOptions({
      providerId,
      selectedModelId,
      models: [],
      disabled: true,
      placeholder: t("settingsAiEnterKeyToLoadModels", [], "Enter an API key to load models"),
    });
    return;
  }

  renderAiModelSelectOptions({
    providerId,
    selectedModelId,
    models: getCuratedAiModelOptions(providerId),
    disabled: false,
    placeholder: t("settingsAiLoadingModels", [], "Loading supported models..."),
  });

  const result = await settingsAiModels?.loadProviderModelOptions?.({
    providerId,
    provider,
    endpointUrl,
    apiKey,
  });

  if (requestId !== aiModelOptionsRequestId) {
    return;
  }

  const models = Array.isArray(result?.models) ? result.models : getCuratedAiModelOptions(providerId);
  const selectedAfterRender = renderAiModelSelectOptions({
    providerId,
    selectedModelId,
    models,
    disabled: models.length === 0,
    placeholder:
      models.length === 0
        ? t("settingsAiNoSupportedModels", [], "No supported lightweight models found")
        : "",
  });

  formElements.aiPredictionModel.title = result?.message || "";

  if (selectedAfterRender !== selectedModelId) {
    draftSettings = readFormSettings();
    updateComputedState(draftSettings);
    syncAiPredictionMismatchWarning();
  }

  if (isLmStudioProvider(providerId) && formElements.aiPredictionEnabled.checked === true) {
    void ensureSelectedLmStudioModelLoadedFromSettings(readFormSettings());
  }
}

function renderAiModelSelectOptions({
  providerId,
  selectedModelId,
  models,
  disabled,
  placeholder,
}) {
  const normalizedModels = Array.isArray(models) ? models : [];
  const modelSelect = formElements.aiPredictionModel;
  const nextSelectedModelId =
    normalizedModels.some((model) => model.id === selectedModelId)
      ? selectedModelId
      : normalizedModels[0]?.id || "";

  modelSelect.textContent = "";

  if (placeholder) {
    const placeholderOption = document.createElement("option");
    placeholderOption.value = "";
    placeholderOption.textContent = placeholder;
    placeholderOption.disabled = normalizedModels.length > 0;
    placeholderOption.selected = !nextSelectedModelId;
    modelSelect.append(placeholderOption);
  }

  for (const model of normalizedModels) {
    const option = document.createElement("option");
    option.value = String(model.id || "");
    option.textContent = formatAiModelOptionLabel(model);
    modelSelect.append(option);
  }

  modelSelect.value = nextSelectedModelId;
  modelSelect.disabled = Boolean(disabled);
  modelSelect.dataset.providerId = providerId || "";

  return nextSelectedModelId;
}

function formatAiModelOptionLabel(model) {
  const modelId = String(model?.id || "");
  const label = String(model?.label || modelId);
  const suffixes = [];

  if (model?.statusLabel) {
    suffixes.push(String(model.statusLabel));
  }

  if (modelId && label !== modelId) {
    suffixes.push(modelId);
  }

  return suffixes.length > 0 ? `${label} (${suffixes.join(" / ")})` : label;
}

function updateComputedState(settings) {
  const effectiveSettings = settingsApi.resolveEffectiveSettings(settings);
  const deviceProfile = effectiveSettings.detectedDeviceProfile;
  deviceProfileLabelElement.textContent = deviceProfile.label;
  deviceProfileMetaElement.textContent = t(
    "settingsHardwareMeta",
    [deviceProfile.hardwareConcurrency || "?", deviceProfile.deviceMemory || "?"],
    `${deviceProfile.hardwareConcurrency || "?"} cores | ${
      deviceProfile.deviceMemory || "?"
    } GB memory hint`
  );
  effectivePreloadCapElement.textContent = String(
    `${effectiveSettings.preloading.effectiveNativeMaxPreloadsPerSource} / ${effectiveSettings.preloading.effectiveTabMaxPreloadsPerSource}`
  );
  const selectedTransitionWindowLabel =
    settingsApi.TRANSITION_WINDOW_OPTIONS?.find(
      (option) => option.value === effectiveSettings.preloading.effectiveTransitionWindowKey
    )?.label ?? t("transitionWindowTotal", [], "Total");
  effectivePreloadMetaElement.textContent = t(
    "settingsEffectivePreloadMeta",
    [selectedTransitionWindowLabel],
    `Native / tab slot caps. Rules use ${selectedTransitionWindowLabel}.`
  );
  watchdogSummaryElement.textContent = effectiveSettings.preloadWindow.watchdogEnabled
    ? t("commonOn", [], "On")
    : t("commonOff", [], "Off");
  watchdogMetaElement.textContent = effectiveSettings.preloadWindow.watchdogEnabled
    ? t(
        "settingsWatchdogChecksEvery",
        [effectiveSettings.preloadWindow.watchdogIntervalSeconds],
        `Checks every ${effectiveSettings.preloadWindow.watchdogIntervalSeconds} second(s).`
      )
    : t("settingsWindowRepairDisabled", [], "Window repair is disabled.");
  watchdogIntervalRowElement.classList.toggle(
    "is-disabled",
    !effectiveSettings.preloadWindow.watchdogEnabled
  );
  transitionWindowScopeRowElement.classList.toggle(
    "has-disabled-select",
    !effectiveSettings.preloading.transitionWindowScope.enabled
  );
  formElements.transitionWindowScope.disabled =
    !effectiveSettings.preloading.transitionWindowScope.enabled;
}

async function saveCurrentSettings() {
  draftSettings = readFormSettings();
  setStatus(t("commonSaving", [], "Saving"), t("settingsWritingLocalSettings", [], "Writing settings to local extension storage."));

  try {
    const storedSettings = await settingsApi.saveSettings(chrome.storage.local, draftSettings);
    savedSettings = storedSettings;
    draftSettings = settingsApi.cloneSettings(storedSettings);
    renderForm(draftSettings);
    void ensureSelectedLmStudioModelLoadedFromSettings(draftSettings);
    setStatus(t("commonSaved", [], "Saved"), t("settingsWrittenSuccessfully", [], "Settings written successfully."));
  } catch (error) {
    console.error(error);
    setStatus(t("commonFailed", [], "Failed"), t("settingsCouldNotSave", [], "Could not save settings."));
  }
}

async function ensureSelectedLmStudioModelLoadedFromSettings(settings) {
  const aiPrediction = settings?.preloading?.aiPrediction ?? {};
  const modelId = String(aiPrediction.modelId || "").trim();

  if (
    aiPrediction.enabled !== true ||
    !isLmStudioProvider(aiPrediction.providerId) ||
    !modelId ||
    pendingLmStudioModelLoadId === modelId ||
    typeof globalThis.ZeroLatencyLmStudio?.loadModel !== "function"
  ) {
    return;
  }

  pendingLmStudioModelLoadId = modelId;
  formElements.aiPredictionModel.title = t(
    "settingsAiLmStudioLoadingModel",
    [modelId],
    `Loading LM Studio model: ${modelId}`
  );

  try {
    const status = await globalThis.ZeroLatencyLmStudio.getModelStatus(modelId).catch(() => null);
    let didRequestLoad = false;

    if (!status?.loaded) {
      await globalThis.ZeroLatencyLmStudio.loadModel(modelId);
      didRequestLoad = true;
      const loaded = await globalThis.ZeroLatencyLmStudio.waitForModelLoaded(modelId);

      if (loaded?.ok !== true) {
        throw new Error(loaded?.reason || "model load timed out");
      }
    }

    if (didRequestLoad) {
      await refreshAiModelOptionsForCurrentProvider();
    }
  } catch (error) {
    formElements.aiPredictionModel.title = `LM Studio model load failed: ${
      error instanceof Error ? error.message : String(error)
    }`;
  } finally {
    if (pendingLmStudioModelLoadId === modelId) {
      pendingLmStudioModelLoadId = "";
    }
  }
}

function isLmStudioProvider(providerId) {
  return (
    globalThis.ZeroLatencyLmStudio?.isLmStudioProvider?.(providerId) === true ||
    String(providerId || "").toLowerCase() === "lmstudio"
  );
}

function activateNavButton(sectionId) {
  for (const button of navButtons) {
    button.classList.toggle("active", button.dataset.sectionTarget === sectionId);
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

function scrollToNavSection(sectionId) {
  const scrollTargets = buildNavScrollTargets();
  const targetScrollTop = scrollTargets.get(sectionId) ?? 0;

  window.scrollTo({
    top: targetScrollTop,
    behavior: "smooth",
  });
}

function syncNavForScrollPosition() {
  const scrollTargets = buildNavScrollTargets();
  activateNavButton(getActiveNavSectionId(window.scrollY, scrollTargets));
}

function queueNavScrollSync() {
  if (pendingNavSyncFrame != null) {
    cancelAnimationFrame(pendingNavSyncFrame);
  }

  pendingNavSyncFrame = requestAnimationFrame(() => {
    pendingNavSyncFrame = null;
    syncNavForScrollPosition();
  });
}

function buildNavScrollTargets() {
  const maxScrollTop = getMaxPageScrollTop();
  const sectionWeights = getNavSectionWeights();
  const totalWeight = sectionWeights.reduce((sum, { weight }) => sum + weight, 0);
  let consumedWeight = 0;

  return new Map(
    sectionWeights.map(({ sectionId, weight }) => {
      const targetScrollTop =
        totalWeight > 0 ? clampScrollTop((consumedWeight / totalWeight) * maxScrollTop, maxScrollTop) : 0;
      consumedWeight += weight;
      return [sectionId, targetScrollTop];
    })
  );
}

function getActiveNavSectionId(scrollTop, scrollTargets) {
  const targetValues = NAV_SECTION_IDS.map((sectionId) => scrollTargets.get(sectionId) ?? 0);

  for (let index = 0; index < targetValues.length - 1; index += 1) {
    const currentTarget = targetValues[index];
    const nextTarget = targetValues[index + 1];
    const boundary = currentTarget + (nextTarget - currentTarget) / 2;

    if (scrollTop < boundary) {
      return NAV_SECTION_IDS[index];
    }
  }

  return NAV_SECTION_IDS[NAV_SECTION_IDS.length - 1];
}

function getMaxPageScrollTop() {
  return Math.max(
    0,
    (document.documentElement?.scrollHeight ?? 0) - window.innerHeight
  );
}

function getNavSectionWeights() {
  return NAV_SECTION_IDS.map((sectionId) => ({
    sectionId,
    weight: getSectionGroupHeight(sectionId),
  }));
}

function getSectionGroupHeight(sectionId) {
  const groupIds = NAV_SECTION_GROUPS[sectionId] ?? [sectionId];
  const totalHeight = groupIds.reduce((sum, groupId) => {
    const element = document.getElementById(groupId);

    if (!element) {
      return sum;
    }

    return sum + element.getBoundingClientRect().height;
  }, 0);

  return Math.max(1, Math.round(totalHeight));
}

function clampScrollTop(value, maxScrollTop) {
  return Math.max(0, Math.min(maxScrollTop, Math.round(value)));
}

function renderRuleCards(settings) {
  renderRuleCardList(preloadRuleCardsListElement, PRELOAD_RULE_CARD_IDS, settings);
  renderRuleCardList(trackingRuleCardsListElement, TRACKING_RULE_CARD_IDS, settings);
}

function renderRuleCardList(container, cardIds, settings) {
  if (!container) {
    return;
  }

  container.textContent = "";

  for (const cardId of cardIds) {
    const cardSchema = RULE_CARD_SCHEMA[cardId];
    const cardState = settings.layout.ruleCards.items?.[cardId];

    if (!cardSchema || !cardState) {
      continue;
    }

    const item = document.createElement("article");
    item.className = "settings-item rule-card preload-rule-card";
    item.dataset.cardId = cardId;

    const info = document.createElement("div");
    info.className = "settings-item-info";

    const title = document.createElement("p");
    title.className = "settings-item-label";
    title.textContent = cardSchema.title;

    const description = document.createElement("p");
    description.className = "settings-item-desc";
    description.textContent = cardSchema.description;

    info.append(title, description);

    const controlArea = document.createElement("div");
    controlArea.className = "settings-item-control rule-card-control";
    controlArea.append(createRuleControlWidget(cardId, cardSchema, cardState));
    item.append(info, controlArea);
    container.append(item);
  }
}

function createRuleControlWidget(cardId, cardSchema, cardState) {
  const control = document.createElement("div");
  control.className = "rule-control rule-controls";

  for (const field of cardSchema.fields) {
    const value = cardState[field.key];
    const fieldShell = document.createElement("label");
    fieldShell.className = "rule-slot";
    fieldShell.title = field.label;

    if (field.type === "number") {
      const isDisabled = isRuleNumberFieldDisabled(cardState, field.key);
      const input = document.createElement("input");
      input.type = "number";
      input.className = "number-input rule-input";
      input.min = String(field.min ?? 0);
      input.max = String(field.max ?? 9999);
      input.value = String(value ?? field.min ?? 0);
      input.placeholder = field.label;
      input.dataset.cardId = cardId;
      input.dataset.fieldKey = field.key;
      input.disabled = isDisabled;
      fieldShell.classList.toggle("is-disabled", isDisabled);
      fieldShell.append(input);
    } else if (field.type === "select") {
      const select = document.createElement("select");
      select.className = "select-input rule-select";
      select.dataset.cardId = cardId;
      select.dataset.fieldKey = field.key;

      for (const optionSpec of field.options) {
        const option = document.createElement("option");
        option.value = String(optionSpec.value);
        option.textContent = optionSpec.label;
        option.selected = String(optionSpec.value) === String(value);
        select.append(option);
      }

      fieldShell.append(select);
    } else if (field.type === "status-toggle") {
      fieldShell.classList.add("is-toggle");

      const switchLabel = document.createElement("span");
      switchLabel.className = "switch";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = value === "enabled";
      input.dataset.cardId = cardId;
      input.dataset.fieldKey = field.key;
      input.setAttribute("aria-label", `${cardSchema.title} ${field.label}`);

      const track = document.createElement("span");
      track.className = "switch-track";

      switchLabel.append(input, track);
      fieldShell.append(switchLabel);
    } else if (field.type === "token") {
      fieldShell.classList.add("is-token");

      const token = document.createElement("input");
      token.type = "text";
      token.className = "number-input rule-input rule-token";
      token.value = field.text;
      token.readOnly = true;
      token.tabIndex = -1;
      token.setAttribute(
        "aria-label",
        `${cardSchema.title} ${t("ruleTokenFixed", [field.text], `fixed token ${field.text}`)}`
      );
      fieldShell.append(token);
    }

    control.append(fieldShell);
  }

  return control;
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

function isRuleNumberFieldDisabled(cardState, fieldKey) {
  if (fieldKey === "valueA") {
    return cardState.operatorA === "disabled";
  }

  if (fieldKey === "valueC") {
    return cardState.operatorB === "disabled";
  }

  return false;
}

async function fetchAndRenderFeatureSupport() {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const snapshot = await chrome.runtime.sendMessage({
      type: "visit-graph:get-debug-snapshot",
      tabId: activeTab?.id,
      pageUrl: activeTab?.url,
    });

    currentFeatureSupport = snapshot?.featureSupport ?? {};
    renderNativeAppStatus(currentFeatureSupport);
  } catch (_error) {
    currentFeatureSupport = {};
    renderNativeAppStatus({});
  }
}

function isLikelyWindowsPlatform() {
  const platform = currentFeatureSupport?.platform ?? {};

  if (platform.windows === true) {
    return true;
  }

  if (platform.mac === true || platform.linux === true) {
    return false;
  }

  return /\bwindows\b/i.test(globalThis.navigator?.userAgent || "");
}

function renderNativeAppStatus(featureSupport) {
  const supported = featureSupport.systemLevelWindowHiding === true;
  const usable = featureSupport.systemLevelWindowHidingUsable === true;
  const platform = featureSupport.platform ?? {};

  if (!supported) {
    nativeAppStatusElement.textContent = "N/A";
    const platformName = platform.mac
      ? "macOS"
      : platform.linux
        ? "Linux"
        : t("commonThisPlatform", [], "this platform");
    nativeAppMetaElement.textContent = t(
      "settingsSystemHidingUnsupported",
      [platformName],
      `System-level hiding not supported on ${platformName}.`
    );
    return;
  }

  if (usable) {
    nativeAppStatusElement.textContent = t("settingsConnected", [], "Connected");
    nativeAppMetaElement.textContent = t(
      "settingsSystemHidingActive",
      [],
      "System-level window hiding is active."
    );
  } else {
    nativeAppStatusElement.textContent = t("settingsOffline", [], "Offline");
    nativeAppMetaElement.textContent = t(
      "settingsNativeAppOffline",
      [],
      "Native app not detected. Using minimize fallback."
    );
  }
}

function syncAiPredictionMismatchWarning() {
  if (!aiPredictionMismatchWarningElement) {
    return;
  }

  const aiPredictionEnabled = formElements.aiPredictionEnabled.checked === true;
  const providerId = String(formElements.aiPredictionProvider.value || "");
  const provider = settingsApi.AI_PROVIDER_BY_ID?.[providerId];
  const providerLabel = provider?.label || providerId || t("commonProvider", [], "provider");
  const modelId = String(formElements.aiPredictionModel.value || "").trim();
  const apiKey = String(formElements.aiProviderApiKey.value || "").trim();
  const endpointUrl = String(formElements.aiProviderEndpoint.value || "").trim();

  if (!aiPredictionEnabled) {
    aiPredictionMismatchWarningElement.classList.add("is-hidden");
    aiPredictionMismatchWarningElement.textContent = "";
    return;
  }

  if (!provider || !modelId || !endpointUrl || (!apiKey && provider.apiKeyOptional !== true)) {
    aiPredictionMismatchWarningElement.textContent = t(
      "settingsAiProviderMissingWarning",
      [providerLabel],
      `AI scoring will stay disabled until ${providerLabel} has a model, endpoint, and API key.`
    );
    aiPredictionMismatchWarningElement.classList.remove("is-hidden");
    return;
  }

  aiPredictionMismatchWarningElement.classList.add("is-hidden");
  aiPredictionMismatchWarningElement.textContent = "";
}
