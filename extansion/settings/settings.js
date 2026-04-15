const settingsApi = globalThis.ZeroLatencySettings;

const formElements = {
  automaticDeviceTuning: document.getElementById("automatic-device-tuning"),
  modeConservative: document.getElementById("mode-conservative"),
  modeBalanced: document.getElementById("mode-balanced"),
  modeAggressive: document.getElementById("mode-aggressive"),
  trackGoogleSearchPages: document.getElementById("track-google-search-pages"),
  preloadingEnabled: document.getElementById("preloading-enabled"),
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
const PRELOAD_RULE_CARD_IDS = settingsApi.PRELOAD_RULE_CARD_IDS ?? ["perPagePreloadLimit"];
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
const watchdogIntervalRowElement = document.getElementById("watchdog-interval-row");
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

void initializeSettingsPage();

async function initializeSettingsPage() {
  bindUiEvents();
  setStatus("Loading", "Reading local extension settings.");

  try {
    savedSettings = await settingsApi.loadSettings(chrome.storage.local);
    draftSettings = settingsApi.cloneSettings(savedSettings);
    renderForm(draftSettings);
    queueNavScrollSync();
    setStatus("Ready", "No unsaved changes.");
  } catch (error) {
    console.error(error);
    setStatus("Failed", "Could not load settings from storage.");
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
}

function handleFormChange() {
  draftSettings = readFormSettings();
  renderRuleCards(draftSettings);
  updateComputedState(draftSettings);
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
    },
    preloading: {
      enabled: formElements.preloadingEnabled.checked,
      mode,
      maxTabsPerSource: draftSettings.preloading.maxTabsPerSource,
      crossSiteCurrentTabSwap: formElements.crossSiteCurrentTabSwap.checked,
    },
    preloadWindow: {
      watchdogEnabled: formElements.watchdogEnabled.checked,
      watchdogIntervalSeconds: Number(formElements.watchdogIntervalSeconds.value) || 1,
      forceMinimize: formElements.forceMinimize.checked,
    },
    experiments: {
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
  queueNavScrollSync();
}

function syncBaseControlsFromSettings(settings) {
  formElements.automaticDeviceTuning.checked = settings.automaticDeviceTuning;
  formElements.modeConservative.checked = settings.preloading.mode === "conservative";
  formElements.modeBalanced.checked = settings.preloading.mode === "balanced";
  formElements.modeAggressive.checked = settings.preloading.mode === "aggressive";
  formElements.trackGoogleSearchPages.checked = settings.tracking.trackGoogleSearchPages;
  formElements.preloadingEnabled.checked = settings.preloading.enabled;
  formElements.crossSiteCurrentTabSwap.checked = settings.preloading.crossSiteCurrentTabSwap;
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
    effectiveSettings.preloading.effectiveMaxTabsPerSource
  );
  effectivePreloadMetaElement.textContent = "Reserved summary card.";
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
