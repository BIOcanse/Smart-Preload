const pageLabelElement = document.getElementById("page-label");
const nodeCountElement = document.getElementById("node-count");
const edgeCountElement = document.getElementById("edge-count");
const updatedAtElement = document.getElementById("updated-at");
const topTargetsElement = document.getElementById("top-edges");
const topTargetsEmptyElement = document.getElementById("top-edges-empty");
const performanceWarningElement = document.getElementById("performance-warning");
const refreshButton = document.getElementById("refresh-button");
const serviceToggleButton = document.getElementById("service-toggle-button");
const settingsButton = document.getElementById("settings-button");
const statusTextElement = document.getElementById("status-text");
const i18n = globalThis.ZeroLatencyI18n;
const t = (key, substitutions = [], fallback = "") =>
  i18n?.t?.(key, substitutions, fallback) || fallback || key;
const popupFormat = globalThis.ZeroLatencyPopupFormat;
const popupTopTargets = globalThis.ZeroLatencyPopupTopTargets;
const popupSnapshotLoader = globalThis.ZeroLatencyPopupSnapshotLoader;
const popupServiceState = globalThis.ZeroLatencyPopupServiceState;
let popupWarnings = null;
let snapshotLoader = null;
let serviceStateController = null;

void initializePopup();

async function initializePopup() {
  await i18n?.initialize?.();
  i18n?.applyDocument?.(document);
  popupWarnings = globalThis.ZeroLatencyPopupWarnings?.create?.({
    element: performanceWarningElement,
    translate: t,
    requestSnapshot: () =>
      chrome.runtime.sendMessage({
        type: "visit-graph:get-debug-snapshot",
        mode: "performance-warning",
      }),
  });
  snapshotLoader = popupSnapshotLoader.create({
    statusTextElement,
    translate: t,
    queryActiveTab: queryActivePopupTab,
    requestSnapshot: requestPopupSnapshot,
    renderSnapshot,
  });
  serviceStateController = popupServiceState.create({
    button: serviceToggleButton,
    setBusy,
    getStatusText: () => statusTextElement.textContent,
    translate: t,
    requestSetPaused: (paused) =>
      chrome.runtime.sendMessage({
        type: "extension:set-service-paused",
        paused,
      }),
    loadSnapshot: () => snapshotLoader.load(),
  });

  refreshButton.addEventListener("click", () => {
    void snapshotLoader.load();
  });

  serviceToggleButton.addEventListener("click", () => {
    void serviceStateController.toggle();
  });

  settingsButton.addEventListener("click", async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "extension:open-settings",
      });

      if (response?.ok === false) {
        throw new Error(response.error || t("popupOpenSettingsFailed", [], "Failed to open settings page."));
      }

      window.close();
    } catch (error) {
      console.error(error);
      statusTextElement.textContent = t("popupOpenSettingsFailed", [], "Failed to open settings page.");
    }
  });

  void snapshotLoader.load();

  chrome.tabs?.onActivated?.addListener?.(() => {
    snapshotLoader.scheduleReload();
  });

  chrome.tabs?.onUpdated?.addListener?.((_tabId, changeInfo, tab) => {
    if (tab?.active === true && (changeInfo?.url || changeInfo?.status === "complete")) {
      snapshotLoader.scheduleReload();
    }
  });

  chrome.windows?.onFocusChanged?.addListener?.(() => {
    snapshotLoader.scheduleReload();
  });
}

async function queryActivePopupTab() {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  return activeTab;
}

async function requestPopupSnapshot(activeTab) {
  return chrome.runtime.sendMessage({
    type: "visit-graph:get-debug-snapshot",
    mode: "popup",
    tabId: activeTab?.id ?? null,
    pageUrl: activeTab?.url ?? null,
  });
}

function renderSnapshot(snapshot) {
  serviceStateController.render(snapshot?.serviceState);
  nodeCountElement.textContent = String(snapshot?.summary?.nodeCount ?? 0);
  edgeCountElement.textContent = String(snapshot?.summary?.edgeCount ?? 0);
  updatedAtElement.textContent = popupFormat.formatUpdatedAt(snapshot?.summary?.updatedAt);
  pageLabelElement.textContent = snapshot?.pageContext?.trackable
    ? snapshot?.pageContext?.pageLabel || t("popupCurrentPage", [], "Current page")
    : t("popupCurrentPageNotTracked", [], "Current page is not tracked");

  popupWarnings?.render?.(popupWarnings.selectRuntimeWarningToDisplay(snapshot));
  popupWarnings?.refreshIfNeeded?.(
    snapshot?.performanceWarning,
    snapshot?.nativeAppModeWarning,
    snapshot?.realPreloadRecommendationWarning
  );
  popupTopTargets.render({
    topTargets: snapshot?.currentTopTargets ?? [],
    pageContext: snapshot?.pageContext,
    serviceState: snapshot?.serviceState,
    listElement: topTargetsElement,
    emptyElement: topTargetsEmptyElement,
    translate: t,
  });
}

function setBusy(isBusy, message) {
  refreshButton.disabled = isBusy;
  serviceToggleButton.disabled = isBusy;
  settingsButton.disabled = isBusy;
  statusTextElement.textContent = message;
}
