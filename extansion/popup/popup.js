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
let servicePaused = false;
let snapshotReloadTimerId = null;
let snapshotLoadInFlight = false;
let snapshotReloadQueued = false;
let performanceWarningRefreshInFlight = false;

i18n?.applyDocument?.(document);

refreshButton.addEventListener("click", () => {
  void loadSnapshot();
});

serviceToggleButton.addEventListener("click", () => {
  void toggleServicePaused();
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

void loadSnapshot();

chrome.tabs?.onActivated?.addListener?.(() => {
  scheduleSnapshotReload();
});

chrome.tabs?.onUpdated?.addListener?.((_tabId, changeInfo, tab) => {
  if (tab?.active === true && (changeInfo?.url || changeInfo?.status === "complete")) {
    scheduleSnapshotReload();
  }
});

chrome.windows?.onFocusChanged?.addListener?.(() => {
  scheduleSnapshotReload();
});

function scheduleSnapshotReload() {
  window.clearTimeout(snapshotReloadTimerId);
  snapshotReloadTimerId = window.setTimeout(() => {
    void loadSnapshot();
  }, 120);
}

async function loadSnapshot() {
  if (snapshotLoadInFlight) {
    snapshotReloadQueued = true;
    return;
  }

  snapshotLoadInFlight = true;
  let statusMessage = t("popupVisitGraphLoaded", [], "Visit graph loaded.");
  statusTextElement.textContent = t("popupLoadingVisitGraph", [], "Loading visit graph...");

  try {
    do {
      snapshotReloadQueued = false;
      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const snapshot = await chrome.runtime.sendMessage({
        type: "visit-graph:get-debug-snapshot",
        mode: "popup",
        tabId: activeTab?.id ?? null,
        pageUrl: activeTab?.url ?? null,
      });

      if (snapshot?.ok === false) {
        throw new Error(snapshot.error || "Unknown snapshot error");
      }

      renderSnapshot(snapshot);
      statusMessage =
        snapshot?.serviceState?.paused === true
          ? t("popupPausedMessage", [], "Plugin stopped: prediction and preloading are disabled.")
          : t("popupVisitGraphLoaded", [], "Visit graph loaded.");
    } while (snapshotReloadQueued);
  } catch (error) {
    console.error(error);
    statusMessage = t("popupLoadVisitGraphFailed", [], "Failed to load visit graph.");
  } finally {
    snapshotLoadInFlight = false;
    snapshotReloadQueued = false;
    statusTextElement.textContent = statusMessage;
  }
}

function renderSnapshot(snapshot) {
  renderServiceState(snapshot?.serviceState);
  nodeCountElement.textContent = String(snapshot?.summary?.nodeCount ?? 0);
  edgeCountElement.textContent = String(snapshot?.summary?.edgeCount ?? 0);
  updatedAtElement.textContent = formatUpdatedAt(snapshot?.summary?.updatedAt);
  pageLabelElement.textContent = snapshot?.pageContext?.trackable
    ? snapshot?.pageContext?.pageLabel || t("popupCurrentPage", [], "Current page")
    : t("popupCurrentPageNotTracked", [], "Current page is not tracked");

  renderPerformanceWarning(snapshot?.performanceWarning);
  refreshPerformanceWarningIfCacheMissing(snapshot?.performanceWarning);
  renderTopTargets(snapshot?.currentTopTargets ?? [], snapshot?.pageContext, snapshot?.serviceState);
}

function renderPerformanceWarning(performanceWarning) {
  if (!performanceWarningElement) {
    return;
  }

  if (performanceWarning?.active !== true) {
    performanceWarningElement.classList.add("hidden");
    return;
  }

  performanceWarningElement.textContent = t(
    performanceWarning.messageKey || "performanceInsufficientReducePreloadCaps",
    [],
    "Performance pressure detected. Lower the preload limits."
  );
  performanceWarningElement.classList.remove("hidden");
}

function refreshPerformanceWarningIfCacheMissing(performanceWarning) {
  if (
    performanceWarning?.reason !== "cache-unavailable" ||
    performanceWarningRefreshInFlight
  ) {
    return;
  }

  performanceWarningRefreshInFlight = true;
  chrome.runtime
    .sendMessage({
      type: "visit-graph:get-debug-snapshot",
      mode: "performance-warning",
    })
    .then((snapshot) => {
      renderPerformanceWarning(snapshot?.performanceWarning);
    })
    .catch((error) => {
      console.error(error);
    })
    .finally(() => {
      performanceWarningRefreshInFlight = false;
    });
}

function renderTopTargets(topTargets, pageContext, serviceState) {
  topTargetsElement.textContent = "";

  if (serviceState?.paused === true) {
    topTargetsEmptyElement.classList.remove("hidden");
    topTargetsEmptyElement.textContent = t(
      "popupPausedMessage",
      [],
      "Plugin stopped: prediction and preloading are disabled."
    );
    return;
  }

  if (!topTargets.length) {
    topTargetsEmptyElement.classList.remove("hidden");
    topTargetsEmptyElement.textContent = pageContext?.trackable
      ? t("popupNoPreloadQualifiedLinks", [], "No preload-qualified links on this page yet.")
      : t("popupCurrentPageNotTrackable", [], "Current page is not trackable.");
    return;
  }

  topTargetsEmptyElement.classList.add("hidden");

  for (const target of topTargets.slice(0, 3)) {
    const item = document.createElement("li");
    item.className = "list-item";

    const title = document.createElement("p");
    title.className = "item-title";
    title.textContent = target.nodeLabel || truncateUrl(target.loadedUrl || target.requestedUrl);

    const meta = document.createElement("p");
    meta.className = "item-meta";
    const siteMeta = formatSiteSelectionMeta(target.siteSelection);
    const frequencyMeta = formatTransitionMetricMeta(target.transitionMetrics);
    const bookmarkMeta = formatBookmarkPreloadMeta(target.bookmarkPreload);
    meta.textContent = [
      t("popupWeightLabel", [formatWeight(target.score)], `Weight: ${formatWeight(target.score)}`),
      frequencyMeta,
      bookmarkMeta,
      siteMeta,
      target.strategy || "hidden-tab",
      target.status || t("commonUnknown", [], "unknown"),
      truncateUrl(target.loadedUrl || target.requestedUrl),
    ]
      .filter(Boolean)
      .join(" | ");

    item.append(title, meta);
    topTargetsElement.append(item);
  }
}

function setBusy(isBusy, message) {
  refreshButton.disabled = isBusy;
  serviceToggleButton.disabled = isBusy;
  settingsButton.disabled = isBusy;
  statusTextElement.textContent = message;
}

async function toggleServicePaused() {
  const nextPaused = !servicePaused;
  let statusMessage = "";

  setBusy(
    true,
    nextPaused
      ? t("popupStoppingService", [], "Stopping prediction and preloading...")
      : t("popupStartingService", [], "Starting prediction and preloading...")
  );

  try {
    const response = await chrome.runtime.sendMessage({
      type: "extension:set-service-paused",
      paused: nextPaused,
    });

    if (response?.ok === false) {
      throw new Error(response.error || t("popupUpdateStateFailed", [], "Failed to update plugin state."));
    }

    renderServiceState(response?.serviceState);
    await loadSnapshot();
    statusMessage = statusTextElement.textContent;
  } catch (error) {
    console.error(error);
    statusMessage = t("popupUpdateStateFailed", [], "Failed to update plugin state.");
  } finally {
    setBusy(false, statusMessage || statusTextElement.textContent);
  }
}

function renderServiceState(serviceState) {
  servicePaused = serviceState?.paused === true;
  serviceToggleButton.textContent = servicePaused
    ? t("popupStart", [], "Start")
    : t("popupStop", [], "Stop");
  serviceToggleButton.title = servicePaused
    ? t("popupRestoreServiceTitle", [], "Resume prediction and preloading")
    : t(
        "popupStopServiceTitle",
        [],
        "Stop prediction and preloading, and close the background preload window"
      );
  serviceToggleButton.classList.toggle("danger", !servicePaused);
  serviceToggleButton.classList.toggle("success", servicePaused);
}

function formatUpdatedAt(timestamp) {
  if (!timestamp) {
    return "-";
  }

  return formatTimestamp(timestamp, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimestamp(timestamp, options = null) {
  if (!timestamp) {
    return "-";
  }

  return new Date(timestamp).toLocaleString(
    undefined,
    options ?? {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }
  );
}

function truncateUrl(url) {
  if (!url) {
    return "-";
  }

  return url.length > 60 ? `${url.slice(0, 57)}...` : url;
}

function formatWeight(score) {
  const numericScore = Number(score);

  if (!Number.isFinite(numericScore)) {
    return "-";
  }

  return numericScore.toFixed(3);
}

function formatSiteSelectionMeta(siteSelection) {
  if (!siteSelection || !Number.isFinite(Number(siteSelection.siteWeight))) {
    return "";
  }

  return t(
    "popupSiteMeta",
    [
      formatWeight(siteSelection.siteWeight),
      siteSelection.siteRank || 0,
      siteSelection.allocatedSlots || 0,
      siteSelection.cap || 0,
    ],
    `Site: ${formatWeight(siteSelection.siteWeight)} (#${siteSelection.siteRank || 0}, ${siteSelection.allocatedSlots || 0}/${siteSelection.cap || 0})`
  );
}

function formatTransitionMetricMeta(transitionMetrics) {
  if (!transitionMetrics) {
    return "";
  }

  const siteCount = Number(transitionMetrics.siteTransitionCount) || 0;
  const outboundPageCount = Number(transitionMetrics.outboundPageTransitionCount) || 0;
  const intraSitePageCount = Number(transitionMetrics.intraSitePageTransitionCount) || 0;

  if (siteCount === 0 && outboundPageCount === 0 && intraSitePageCount === 0) {
    return "";
  }

  return t(
    "popupFreqMeta",
    [siteCount, outboundPageCount, intraSitePageCount],
    `Freq: site ${siteCount}, out ${outboundPageCount}, in ${intraSitePageCount}`
  );
}

function formatBookmarkPreloadMeta(bookmarkPreload) {
  if (!bookmarkPreload) {
    return "";
  }

  const count = Number(bookmarkPreload.count) || 0;
  const rank = Number(bookmarkPreload.rank) || 0;

  if (count === 0 && rank === 0) {
    return "";
  }

  return t(
    "popupBookmarkMeta",
    [count, rank],
    `Bookmark: ${count}, rank ${rank}`
  );
}
