const settingsApi = globalThis.ZeroLatencySettings;

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
  aiPredictionModel: document.getElementById("ai-prediction-model"),
  aiPredictionEnabled: document.getElementById("ai-prediction-enabled"),
  manageAiModel: document.getElementById("manage-ai-model"),
  manageAiModelDownloaded: document.getElementById("manage-ai-model-downloaded"),
  crossSiteCurrentTabSwap: document.getElementById("cross-site-current-tab-swap"),
  watchdogEnabled: document.getElementById("watchdog-enabled"),
  watchdogIntervalSeconds: document.getElementById("watchdog-interval-seconds"),
  forceMinimize: document.getElementById("force-minimize"),
  idleWakeAggressive: document.getElementById("idle-wake-aggressive"),
  pointerProximityPrediction: document.getElementById("pointer-proximity-prediction"),
  authStateWarmup: document.getElementById("auth-state-warmup"),
};

const saveButton = document.getElementById("save-button");
const resetButton = document.getElementById("reset-button");
const navButtons = Array.from(document.querySelectorAll(".settings-nav-item"));
const aiProgressToastElement = document.getElementById("ai-progress-toast");
const aiProgressToastTitleElement = document.getElementById("ai-progress-toast-title");
const aiProgressToastMessageElement = document.getElementById("ai-progress-toast-message");
const aiProgressToastBarElement = aiProgressToastElement?.querySelector(".ai-progress-toast-bar");
const aiProgressToastBarFillElement = document.getElementById("ai-progress-toast-bar-fill");
const aiProgressToastMetaElement = document.getElementById("ai-progress-toast-meta");
const aiProgressToastDismissElement = document.getElementById("ai-progress-toast-dismiss");
const aiPredictionMismatchWarningElement = document.getElementById("ai-prediction-mismatch-warning");
const aiManagePlatformWarningElement = document.getElementById("ai-manage-platform-warning");
const PRELOAD_RULE_CARD_IDS =
  settingsApi.PRELOAD_RULE_CARD_IDS ?? ["nativePerPagePreloadLimit", "perPagePreloadLimit"];
const NAV_SECTION_IDS = ["overview", "tracking", "preload", "ordering", "experiments"];
const NAV_SECTION_GROUPS = {
  overview: ["overview", "overview-panel"],
  tracking: ["tracking"],
  preload: ["preload"],
  ordering: ["ordering"],
  experiments: ["experiments"],
};
const preloadRuleCardsListElement = document.getElementById("preload-rule-cards-list");
const sortableCardsListElement = document.getElementById("sortable-cards-list");

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
let armedDragCardId = null;
let activeDragCardId = null;
let activeDropTarget = null;
let pendingNavSyncFrame = null;
let nativeAiModelStatus = null;
let manageAiModelActionInFlight = false;
let currentFeatureSupport = {};
let aiProgressPollHandle = null;
let aiStatusPollHandle = null;
let lastDisplayedAiProgress = null;
let aiProgressToastDismissed = false;
const AI_PROGRESS_POLL_INTERVAL_MS = 500;
const AI_STATUS_POLL_INTERVAL_MS = 1000;
const AI_PROGRESS_STALE_AFTER_MS = 5 * 60 * 1000;

void initializeSettingsPage();

async function initializeSettingsPage() {
  populateTransitionWindowOptions();
  populateAiModelOptions();
  bindUiEvents();
  setStatus("Loading", "Reading local extension settings.");

  try {
    savedSettings = await settingsApi.loadSettings(chrome.storage.local);
    draftSettings = settingsApi.cloneSettings(savedSettings);
    renderForm(draftSettings);
    queueNavScrollSync();
    setStatus("Ready", "No unsaved changes.");
    await fetchAndRenderFeatureSupport();
    await fetchAndSyncAiModelStatus();
    await checkInitialAiProgress();
    startAiStatusBackgroundPolling();
  } catch (error) {
    console.error(error);
    setStatus("Failed", "Could not load settings from storage.");
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

function populateAiModelOptions() {
  const options = Array.isArray(settingsApi.AI_MODEL_OPTIONS)
    ? settingsApi.AI_MODEL_OPTIONS
    : [];

  for (const selectElement of [formElements.aiPredictionModel, formElements.manageAiModel]) {
    selectElement.textContent = "";

    for (const optionSpec of options) {
      const option = document.createElement("option");
      option.value = String(optionSpec.value);
      option.textContent = optionSpec.label;
      selectElement.append(option);
    }
  }
}

function bindUiEvents() {
  for (const element of Object.values(formElements)) {
    element.addEventListener("change", handleFormChange);
    element.addEventListener("input", handleFormChange);
  }

  sortableCardsListElement.addEventListener("mousedown", (event) => {
    const card = event.target.closest(".sortable-space-item");

    if (!card || isInteractiveDragBlocker(event.target)) {
      armedDragCardId = null;
      return;
    }

    armedDragCardId = card.dataset.cardId ?? null;
  });
  document.addEventListener("mouseup", () => {
    if (!activeDragCardId) {
      armedDragCardId = null;
    }
  });

  sortableCardsListElement.addEventListener("dragstart", handleSortableCardDragStart);
  sortableCardsListElement.addEventListener("dragover", handleSortableCardDragOver);
  sortableCardsListElement.addEventListener("drop", handleSortableCardDrop);
  sortableCardsListElement.addEventListener("dragend", clearSortableCardDragState);
  sortableCardsListElement.addEventListener("input", handleSortableCardInput);
  sortableCardsListElement.addEventListener("change", handleSortableCardInput);
  preloadRuleCardsListElement?.addEventListener("input", handleSortableCardInput);
  preloadRuleCardsListElement?.addEventListener("change", handleSortableCardInput);

  saveButton.addEventListener("click", async () => {
    await saveCurrentSettings();
  });

  resetButton.addEventListener("click", () => {
    draftSettings = settingsApi.cloneSettings(settingsApi.DEFAULT_SETTINGS);
    renderForm(draftSettings);
    if (isDirty()) {
      setDirtyStatus("Defaults restored in the form. Save to apply.");
    } else {
      setStatus("Ready", "No unsaved changes.");
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

  aiProgressToastDismissElement?.addEventListener("click", () => {
    aiProgressToastDismissed = true;
    hideAiProgressToast();
  });

  document.addEventListener("visibilitychange", handleSettingsVisibilityChange);
}

function handleSettingsVisibilityChange() {
  if (document.visibilityState === "visible") {
    startAiStatusBackgroundPolling();
  } else {
    stopAiStatusBackgroundPolling();
  }
}

async function handleFormChange(event) {
  if (event?.target === formElements.manageAiModelDownloaded) {
    if (manageAiModelActionInFlight) {
      event.preventDefault();
      syncManageAiModelDownloadedToggle();
      return;
    }
    await handleManageAiModelToggle();
    return;
  }

  if (event?.target === formElements.manageAiModel) {
    syncManageAiModelDownloadedToggle();
  }

  draftSettings = readFormSettings();
  renderRuleCards(draftSettings);
  updateComputedState(draftSettings);
  syncAiPredictionMismatchWarning();
  queueNavScrollSync();

  if (isDirty()) {
    setDirtyStatus("Unsaved changes are ready to be applied.");
  } else {
    setStatus("Ready", "No unsaved changes.");
  }
}

function readFormSettings() {
  let mode = "balanced";

  if (formElements.modeConservative.checked) {
    mode = "conservative";
  } else if (formElements.modeAggressive.checked) {
    mode = "aggressive";
  }

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
        modelId: formElements.aiPredictionModel.value,
      },
      modelManager: {
        selectedModelId: formElements.manageAiModel.value,
        downloadedModels: {
          ...(draftSettings.preloading?.modelManager?.downloadedModels ?? {}),
          [formElements.manageAiModel.value]: formElements.manageAiModelDownloaded.checked,
        },
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
    layout: {
      sortableCards: {
        order: [...draftSettings.layout.sortableCards.order],
        items: settingsApi.cloneSettings(draftSettings.layout.sortableCards.items),
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
  formElements.aiPredictionModel.value = settings.preloading.aiPrediction.modelId;
  formElements.manageAiModel.value = settings.preloading.modelManager.selectedModelId;
  syncManageAiModelDownloadedToggle(settings);
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
}

function updateComputedState(settings) {
  const effectiveSettings = settingsApi.resolveEffectiveSettings(settings);
  const deviceProfile = effectiveSettings.detectedDeviceProfile;
  deviceProfileLabelElement.textContent = deviceProfile.label;
  deviceProfileMetaElement.textContent = `${deviceProfile.hardwareConcurrency || "?"} cores | ${
    deviceProfile.deviceMemory || "?"
  } GB memory hint`;
  effectivePreloadCapElement.textContent = String(
    `${effectiveSettings.preloading.effectiveNativeMaxPreloadsPerSource} / ${effectiveSettings.preloading.effectiveTabMaxPreloadsPerSource}`
  );
  const selectedTransitionWindowLabel =
    settingsApi.TRANSITION_WINDOW_OPTIONS?.find(
      (option) => option.value === effectiveSettings.preloading.effectiveTransitionWindowKey
    )?.label ?? "总量";
  effectivePreloadMetaElement.textContent =
    `Native / tab slot caps. Rules use ${selectedTransitionWindowLabel}.`;
  watchdogSummaryElement.textContent = effectiveSettings.preloadWindow.watchdogEnabled
    ? "On"
    : "Off";
  watchdogMetaElement.textContent = effectiveSettings.preloadWindow.watchdogEnabled
    ? `Checks every ${effectiveSettings.preloadWindow.watchdogIntervalSeconds} second(s).`
    : "Window repair is disabled.";
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
  setStatus("Saving", "Writing settings to local extension storage.");

  try {
    const storedSettings = await settingsApi.saveSettings(chrome.storage.local, draftSettings);
    savedSettings = storedSettings;
    draftSettings = settingsApi.cloneSettings(storedSettings);
    renderForm(draftSettings);
    setStatus("Saved", "Settings written successfully.");
  } catch (error) {
    console.error(error);
    setStatus("Failed", "Could not save settings.");
  }
}

async function handleManageAiModelToggle() {
  if (manageAiModelActionInFlight) {
    return;
  }

  const selectedModelId = String(formElements.manageAiModel.value || "");
  const shouldInstall = formElements.manageAiModelDownloaded.checked === true;

  manageAiModelActionInFlight = true;
  syncManageAiModelControlAvailability(false);
  aiProgressToastDismissed = false;
  showAiProgressToast({
    model_id: selectedModelId,
    action: shouldInstall ? "install" : "uninstall",
    stage: shouldInstall ? "ensuring-runtime" : "removing",
    message: shouldInstall
      ? "Preparing portable runtime if needed."
      : "Removing the selected model.",
    completed_bytes: 0,
    total_bytes: 0,
    finished: false,
  });
  startAiProgressPolling();
  setStatus(
    shouldInstall ? "Downloading" : "Removing",
    shouldInstall
      ? "Installing runtime if needed, then downloading the selected model."
      : "Removing the selected model and pruning the portable runtime if unused."
  );

  try {
    const response = await chrome.runtime.sendMessage({
      type: "ai-models:set-installed",
      modelId: selectedModelId,
      installed: shouldInstall,
    });

    if (!response?.ok) {
      throw new Error(response?.error || "AI model action failed.");
    }

    applyNativeAiModelStatus(response.status, response.settings);
    if (isDirty()) {
      setDirtyStatus("Model state updated. Other unsaved changes are still pending.");
    } else {
      setStatus(
        shouldInstall ? "Downloaded" : "Removed",
        "Portable runtime and model state updated."
      );
    }
    showAiProgressToast({
      model_id: selectedModelId,
      action: shouldInstall ? "install" : "uninstall",
      stage: "complete",
      message: shouldInstall ? "Model downloaded." : "Model removed.",
      completed_bytes: 0,
      total_bytes: 0,
      finished: true,
    });
  } catch (error) {
    console.error(error);
    syncManageAiModelDownloadedToggle();
    setStatus("Failed", "Could not update the selected model.");
    showAiProgressToast({
      model_id: selectedModelId,
      action: shouldInstall ? "install" : "uninstall",
      stage: "failed",
      message: error instanceof Error ? error.message : String(error),
      completed_bytes: 0,
      total_bytes: 0,
      finished: true,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    manageAiModelActionInFlight = false;
    syncManageAiModelControlAvailability(isManageAiModelControlUsable());
    stopAiProgressPolling();
    void fetchAndSyncAiModelStatus();
  }
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
  footerStatusTitleElement.textContent = "Unsaved";
  footerStatusTextElement.textContent = message;
  navStatusTextElement.textContent = "Unsaved changes";
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
  renderRuleCardList(preloadRuleCardsListElement, PRELOAD_RULE_CARD_IDS, settings, false);
  renderRuleCardList(sortableCardsListElement, settings.layout.sortableCards.order, settings, true);
}

function renderRuleCardList(container, cardIds, settings, isSortable) {
  if (!container) {
    return;
  }

  container.textContent = "";

  for (const cardId of cardIds) {
    const cardSchema = RULE_CARD_SCHEMA[cardId];
    const cardState = settings.layout.sortableCards.items?.[cardId];

    if (!cardSchema || !cardState) {
      continue;
    }

    const item = document.createElement("article");
    item.className = isSortable
      ? "settings-item sortable-space-item sortable-rule-item"
      : "settings-item sortable-rule-item preload-rule-card";
    item.dataset.cardId = cardId;
    item.draggable = isSortable;

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
    controlArea.className = "settings-item-control sortable-space-item-control";
    controlArea.append(createSortableControlWidget(cardId, cardSchema, cardState));
    item.append(info, controlArea);
    container.append(item);
  }
}

function createSortableControlWidget(cardId, cardSchema, cardState) {
  const control = document.createElement("div");
  control.className = "sortable-space-control sortable-rule-controls";

  for (const field of cardSchema.fields) {
    const value = cardState[field.key];
    const fieldShell = document.createElement("label");
    fieldShell.className = "sortable-rule-slot";
    fieldShell.title = field.label;

    if (field.type === "number") {
      const isDisabled = isRuleNumberFieldDisabled(cardState, field.key);
      const input = document.createElement("input");
      input.type = "number";
      input.className = "number-input sortable-rule-input";
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
      select.className = "select-input sortable-rule-select";
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
      token.className = "number-input sortable-rule-input sortable-rule-token";
      token.value = field.text;
      token.readOnly = true;
      token.tabIndex = -1;
      token.setAttribute("aria-label", `${cardSchema.title} 固定占位 ${field.text}`);
      fieldShell.append(token);
    }

    control.append(fieldShell);
  }

  return control;
}

function handleSortableCardInput(event) {
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
    updateSortableCardField(draftSettings, cardId, fieldKey, nextValue)
  );

  if (fieldSchema.type === "number") {
    input.value = String(draftSettings.layout.sortableCards.items[cardId][fieldKey]);
  }

  if (fieldSchema.type === "select") {
    renderRuleCards(draftSettings);
  }

  if (isDirty()) {
    setDirtyStatus("Unsaved changes are ready to be applied.");
  } else {
    setStatus("Ready", "No unsaved changes.");
  }
}

function updateSortableCardField(source, cardId, fieldKey, value) {
  const nextState = settingsApi.cloneSettings(source);

  if (!nextState.layout?.sortableCards?.items?.[cardId]) {
    return nextState;
  }

  nextState.layout.sortableCards.items[cardId][fieldKey] = value;
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

function handleSortableCardDragStart(event) {
  const card = event.target.closest(".sortable-space-item");

  if (!card || armedDragCardId !== card.dataset.cardId) {
    event.preventDefault();
    return;
  }

  activeDragCardId = card.dataset.cardId;
  card.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", activeDragCardId);
}

function handleSortableCardDragOver(event) {
  if (!activeDragCardId) {
    return;
  }

  event.preventDefault();
  const targetCard = event.target.closest(".sortable-space-item");

  if (!targetCard || targetCard.dataset.cardId === activeDragCardId) {
    clearDropTargetClasses();
    activeDropTarget = null;
    return;
  }

  const placement = getDropPlacement(targetCard, event.clientY);
  applyDropTargetClasses(targetCard, placement);
  activeDropTarget = {
    cardId: targetCard.dataset.cardId,
    placement,
  };
}

function handleSortableCardDrop(event) {
  if (!activeDragCardId) {
    return;
  }

  event.preventDefault();
  const nextOrder = moveSortableCard(
    draftSettings.layout.sortableCards.order,
    activeDragCardId,
    activeDropTarget?.cardId ?? null,
    activeDropTarget?.placement ?? "after"
  );

  draftSettings = settingsApi.normalizeStoredSettings({
    ...draftSettings,
    layout: {
      sortableCards: {
        order: nextOrder,
        items: settingsApi.cloneSettings(draftSettings.layout.sortableCards.items),
      },
    },
  });

  renderRuleCards(draftSettings);
  clearSortableCardDragState();

  if (isDirty()) {
    setDirtyStatus("Card order changed. Save to apply.");
  } else {
    setStatus("Ready", "No unsaved changes.");
  }
}

function isInteractiveDragBlocker(target) {
  return Boolean(
    target.closest(
      "input, select, textarea, button, a, label, .switch, .switch-track, .segmented-control, .segment"
    )
  );
}

function moveSortableCard(order, draggedCardId, targetCardId, placement) {
  const nextOrder = [...order];
  const draggedIndex = nextOrder.indexOf(draggedCardId);

  if (draggedIndex === -1) {
    return nextOrder;
  }

  nextOrder.splice(draggedIndex, 1);

  if (!targetCardId) {
    nextOrder.push(draggedCardId);
    return nextOrder;
  }

  const targetIndex = nextOrder.indexOf(targetCardId);

  if (targetIndex === -1) {
    nextOrder.push(draggedCardId);
    return nextOrder;
  }

  const insertionIndex = placement === "before" ? targetIndex : targetIndex + 1;
  nextOrder.splice(insertionIndex, 0, draggedCardId);
  return nextOrder;
}

function getDropPlacement(targetCard, clientY) {
  const bounds = targetCard.getBoundingClientRect();
  return clientY < bounds.top + bounds.height / 2 ? "before" : "after";
}

function clearDropTargetClasses() {
  for (const card of sortableCardsListElement.querySelectorAll(".sortable-space-item")) {
    card.classList.remove("is-drop-target-before", "is-drop-target-after");
  }
}

function applyDropTargetClasses(targetCard, placement) {
  clearDropTargetClasses();

  const previousCard = getAdjacentSortableCard(targetCard, "previousElementSibling");
  const nextCard = getAdjacentSortableCard(targetCard, "nextElementSibling");

  if (placement === "before") {
    targetCard.classList.add("is-drop-target-before");
    previousCard?.classList.add("is-drop-target-after");
    return;
  }

  targetCard.classList.add("is-drop-target-after");
  nextCard?.classList.add("is-drop-target-before");
}

function getAdjacentSortableCard(startCard, directionKey) {
  let cursor = startCard?.[directionKey] ?? null;

  while (cursor && !cursor.classList?.contains("sortable-space-item")) {
    cursor = cursor[directionKey] ?? null;
  }

  return cursor;
}

function clearSortableCardDragState() {
  armedDragCardId = null;
  activeDragCardId = null;
  activeDropTarget = null;
  clearDropTargetClasses();

  for (const card of sortableCardsListElement.querySelectorAll(".sortable-space-item")) {
    card.classList.remove("is-dragging");
  }
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
    syncManagePlatformWarning(currentFeatureSupport);
    syncManageAiModelControlAvailability(isManageAiModelControlUsable());
  } catch (_error) {
    currentFeatureSupport = {};
    renderNativeAppStatus({});
    syncManagePlatformWarning({});
    syncManageAiModelControlAvailability(isManageAiModelControlUsable());
  }
}

async function fetchAndSyncAiModelStatus() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "ai-models:get-status",
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not load AI model status.");
    }

    currentFeatureSupport = {
      ...currentFeatureSupport,
      aiModelManagement: true,
      aiModelManagementUsable: true,
    };
    applyNativeAiModelStatus(response.status, response.settings);
    syncManageAiModelControlAvailability(isManageAiModelControlUsable());
  } catch (error) {
    console.error(error);
    syncManageAiModelControlAvailability(isManageAiModelControlUsable());
  }
}

function applyNativeAiModelStatus(status, serverSettings) {
  nativeAiModelStatus = status ?? null;
  savedSettings = mergeNativeAiStatusIntoSettings(
    serverSettings ? settingsApi.normalizeStoredSettings(serverSettings) : savedSettings,
    nativeAiModelStatus
  );
  draftSettings = mergeNativeAiStatusIntoSettings(draftSettings, nativeAiModelStatus);
  renderForm(draftSettings);
}

function mergeNativeAiStatusIntoSettings(sourceSettings, nativeStatus) {
  if (!nativeStatus) {
    return settingsApi.normalizeStoredSettings(sourceSettings);
  }

  const downloadedModels = {};

  for (const optionSpec of settingsApi.AI_MODEL_OPTIONS ?? []) {
    downloadedModels[optionSpec.value] = false;
  }

  for (const modelStatus of nativeStatus.models ?? []) {
    if (typeof modelStatus?.id === "string") {
      downloadedModels[modelStatus.id] = modelStatus.downloaded === true;
    }
  }

  const installedRuntimeIds = (nativeStatus.runtimes ?? [])
    .filter((runtimeStatus) => runtimeStatus?.installed === true && typeof runtimeStatus?.id === "string")
    .map((runtimeStatus) => runtimeStatus.id);

  return settingsApi.normalizeStoredSettings({
    ...sourceSettings,
    preloading: {
      ...sourceSettings.preloading,
      modelManager: {
        ...sourceSettings.preloading.modelManager,
        downloadedModels,
        installedRuntimeIds,
      },
    },
  });
}

function syncManageAiModelDownloadedToggle(settings = draftSettings) {
  const selectedModelId = String(formElements.manageAiModel.value || "");
  const downloadedStateFromNative = nativeAiModelStatus?.models?.find(
    (modelStatus) => modelStatus?.id === selectedModelId
  )?.downloaded;
  const downloadedStateFromSettings = Boolean(
    settings.preloading?.modelManager?.downloadedModels?.[selectedModelId]
  );

  formElements.manageAiModelDownloaded.checked =
    typeof downloadedStateFromNative === "boolean"
      ? downloadedStateFromNative
      : downloadedStateFromSettings;
}

function syncManageAiModelControlAvailability(enabled) {
  const interactive = enabled === true && !manageAiModelActionInFlight;
  formElements.manageAiModel.disabled = !interactive;
  formElements.manageAiModelDownloaded.disabled = !interactive;
}

function isManageAiModelControlUsable() {
  if (nativeAiModelStatus) {
    return true;
  }

  return (
    currentFeatureSupport.aiModelManagement === true ||
    currentFeatureSupport.aiModelManagementUsable === true ||
    isLikelyWindowsPlatform()
  );
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
    const platformName = platform.mac ? "macOS" : platform.linux ? "Linux" : "this platform";
    nativeAppMetaElement.textContent = `System-level hiding not supported on ${platformName}.`;
    return;
  }

  if (usable) {
    nativeAppStatusElement.textContent = "Connected";
    nativeAppMetaElement.textContent = "System-level window hiding is active.";
  } else {
    nativeAppStatusElement.textContent = "Offline";
    nativeAppMetaElement.textContent = "Native app not detected. Using minimize fallback.";
  }
}

function showAiProgressToast(progress) {
  if (!aiProgressToastElement || aiProgressToastDismissed) {
    return;
  }

  lastDisplayedAiProgress = progress;
  aiProgressToastElement.classList.remove("is-hidden", "is-complete", "is-failed");

  const stage = String(progress?.stage || "");
  const action = String(progress?.action || "");
  const modelLabel = getAiModelLabel(progress?.model_id);
  const actionVerb = action === "uninstall" ? "Removing" : "Installing";
  let titleText;

  if (stage === "complete") {
    titleText = action === "uninstall" ? "Model removed" : "Model ready";
    aiProgressToastElement.classList.add("is-complete");
  } else if (stage === "failed") {
    titleText = action === "uninstall" ? "Uninstall failed" : "Install failed";
    aiProgressToastElement.classList.add("is-failed");
  } else {
    titleText = `${actionVerb} ${modelLabel}`;
  }

  aiProgressToastTitleElement.textContent = titleText;
  aiProgressToastMessageElement.textContent = progress?.message
    ? String(progress.message)
    : stage === "complete"
      ? "Done."
      : stage === "failed"
        ? "The task did not finish."
        : "Working...";

  updateAiProgressBar(progress);
  aiProgressToastMetaElement.textContent = buildAiProgressMeta(progress);

  if (aiProgressToastDismissElement) {
    aiProgressToastDismissElement.classList.toggle("is-hidden", progress?.finished !== true);
  }

  if (progress?.finished === true) {
    stopAiProgressPolling();
  }
}

function updateAiProgressBar(progress) {
  if (!aiProgressToastBarElement || !aiProgressToastBarFillElement) {
    return;
  }

  const total = Number(progress?.total_bytes) || 0;
  const completed = Number(progress?.completed_bytes) || 0;
  const finished = progress?.finished === true;
  const failed = progress?.stage === "failed";

  aiProgressToastBarElement.classList.remove("is-indeterminate");

  if (finished && !failed) {
    aiProgressToastBarFillElement.style.width = "100%";
    return;
  }

  if (failed) {
    aiProgressToastBarFillElement.style.width = "0%";
    return;
  }

  if (total > 0) {
    const pct = Math.min(100, Math.max(0, (completed / total) * 100));
    aiProgressToastBarFillElement.style.width = `${pct.toFixed(1)}%`;
    return;
  }

  aiProgressToastBarElement.classList.add("is-indeterminate");
  aiProgressToastBarFillElement.style.width = "40%";
}

function buildAiProgressMeta(progress) {
  const total = Number(progress?.total_bytes) || 0;
  const completed = Number(progress?.completed_bytes) || 0;

  if (total > 0) {
    const pct = Math.min(100, Math.max(0, (completed / total) * 100));
    return `${formatBytes(completed)} / ${formatBytes(total)} (${pct.toFixed(1)}%)`;
  }

  if (progress?.stage === "failed" && progress?.error) {
    return String(progress.error);
  }

  return "";
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;

  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function getAiModelLabel(modelId) {
  const option = (settingsApi.AI_MODEL_OPTIONS ?? []).find(
    (spec) => String(spec.value) === String(modelId || "")
  );
  return option?.label ?? (modelId ? String(modelId) : "model");
}

function hideAiProgressToast() {
  if (!aiProgressToastElement) {
    return;
  }
  aiProgressToastElement.classList.add("is-hidden");
}

function startAiProgressPolling() {
  if (aiProgressPollHandle != null) {
    return;
  }

  aiProgressPollHandle = setInterval(() => {
    void pollAiProgressOnce();
  }, AI_PROGRESS_POLL_INTERVAL_MS);
}

function stopAiProgressPolling() {
  if (aiProgressPollHandle == null) {
    return;
  }
  clearInterval(aiProgressPollHandle);
  aiProgressPollHandle = null;
}

async function pollAiProgressOnce() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "ai-models:get-progress",
    });

    if (!response?.ok) {
      return;
    }

    const progress = response.progress;

    if (!progress) {
      return;
    }

    if (aiProgressToastDismissed) {
      if (progress.finished === true) {
        stopAiProgressPolling();
      }
      return;
    }

    showAiProgressToast(progress);
  } catch (_error) {
    // Ignore transient polling errors.
  }
}

async function checkInitialAiProgress() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "ai-models:get-progress",
    });

    if (!response?.ok || !response.progress) {
      return;
    }

    const progress = response.progress;
    const updatedAt = Number(progress.updated_at_ms) || 0;
    const stale = updatedAt > 0 && Date.now() - updatedAt > AI_PROGRESS_STALE_AFTER_MS;

    if (progress.finished === true || stale) {
      return;
    }

    aiProgressToastDismissed = false;
    showAiProgressToast(progress);
    startAiProgressPolling();
  } catch (_error) {
    // Ignore — nothing to resume.
  }
}

function startAiStatusBackgroundPolling() {
  if (aiStatusPollHandle != null || document.visibilityState !== "visible") {
    return;
  }

  aiStatusPollHandle = setInterval(() => {
    if (document.visibilityState !== "visible") {
      return;
    }
    if (manageAiModelActionInFlight) {
      return;
    }
    void fetchAndSyncAiModelStatus();
  }, AI_STATUS_POLL_INTERVAL_MS);
}

function stopAiStatusBackgroundPolling() {
  if (aiStatusPollHandle == null) {
    return;
  }
  clearInterval(aiStatusPollHandle);
  aiStatusPollHandle = null;
}

function syncAiPredictionMismatchWarning() {
  if (!aiPredictionMismatchWarningElement) {
    return;
  }

  const aiPredictionEnabled = formElements.aiPredictionEnabled.checked === true;
  const selectedPredictionModelId = String(formElements.aiPredictionModel.value || "");
  const downloadedMap =
    draftSettings.preloading?.modelManager?.downloadedModels ?? {};
  const isDownloaded = downloadedMap[selectedPredictionModelId] === true;
  const manageSelectedModelId = String(formElements.manageAiModel.value || "");
  const mismatchesManageSelection =
    manageSelectedModelId !== "" && manageSelectedModelId !== selectedPredictionModelId;

  if (!aiPredictionEnabled) {
    aiPredictionMismatchWarningElement.classList.add("is-hidden");
    aiPredictionMismatchWarningElement.textContent = "";
    return;
  }

  if (!isDownloaded) {
    const label = getAiModelLabel(selectedPredictionModelId);
    const managerHint = mismatchesManageSelection
      ? `「管理模型」当前选中的是 ${getAiModelLabel(manageSelectedModelId)}，请先切换到 ${label} 再下载。`
      : `请在下方「管理模型」里先下载 ${label}。`;
    aiPredictionMismatchWarningElement.textContent = `当前选择的 AI 预测模型 ${label} 尚未下载，AI 评分暂不会启用。${managerHint}`;
    aiPredictionMismatchWarningElement.classList.remove("is-hidden");
    return;
  }

  aiPredictionMismatchWarningElement.classList.add("is-hidden");
  aiPredictionMismatchWarningElement.textContent = "";
}

function syncManagePlatformWarning(featureSupport) {
  if (!aiManagePlatformWarningElement) {
    return;
  }

  const supported =
    featureSupport?.aiModelManagement === true || isLikelyWindowsPlatform();

  if (supported) {
    aiManagePlatformWarningElement.classList.add("is-hidden");
    aiManagePlatformWarningElement.textContent = "";
    return;
  }

  const platform = featureSupport?.platform ?? {};
  const platformName = platform.mac
    ? "macOS"
    : platform.linux
      ? "Linux"
      : "当前平台";
  aiManagePlatformWarningElement.textContent = `模型下载与运行目前仅在 Windows 上可用，${platformName}暂不支持管理本地模型。`;
  aiManagePlatformWarningElement.classList.remove("is-hidden");
}
