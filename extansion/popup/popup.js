const pageLabelElement = document.getElementById("page-label");
const nodeCountElement = document.getElementById("node-count");
const edgeCountElement = document.getElementById("edge-count");
const updatedAtElement = document.getElementById("updated-at");
const topTargetsElement = document.getElementById("top-edges");
const topTargetsEmptyElement = document.getElementById("top-edges-empty");
const refreshButton = document.getElementById("refresh-button");
const serviceToggleButton = document.getElementById("service-toggle-button");
const settingsButton = document.getElementById("settings-button");
const statusTextElement = document.getElementById("status-text");
const i18n = globalThis.ZeroLatencyI18n;
const t = (key, substitutions = [], fallback = "") =>
  i18n?.t?.(key, substitutions, fallback) || fallback || key;
let servicePaused = false;

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

async function loadSnapshot() {
  setBusy(true, t("popupLoadingVisitGraph", [], "Loading visit graph..."));

  try {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const snapshot = await chrome.runtime.sendMessage({
      type: "visit-graph:get-debug-snapshot",
      tabId: activeTab?.id ?? null,
      pageUrl: activeTab?.url ?? null,
    });

    if (snapshot?.ok === false) {
      throw new Error(snapshot.error || "Unknown snapshot error");
    }

    renderSnapshot(snapshot);
    setBusy(
      false,
      snapshot?.serviceState?.paused === true
        ? t("popupPausedMessage", [], "Plugin stopped: prediction and preloading are disabled.")
        : t("popupVisitGraphLoaded", [], "Visit graph loaded.")
    );
  } catch (error) {
    console.error(error);
    setBusy(false, t("popupLoadVisitGraphFailed", [], "Failed to load visit graph."));
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

  renderTopTargets(snapshot?.currentTopTargets ?? [], snapshot?.pageContext, snapshot?.serviceState);
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
  statusTextElement.textContent = message;
}

async function toggleServicePaused() {
  const nextPaused = !servicePaused;

  serviceToggleButton.disabled = true;
  statusTextElement.textContent = nextPaused
    ? t("popupStoppingService", [], "Stopping prediction and preloading...")
    : t("popupStartingService", [], "Starting prediction and preloading...");

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
  } catch (error) {
    console.error(error);
    statusTextElement.textContent = t("popupUpdateStateFailed", [], "Failed to update plugin state.");
  } finally {
    serviceToggleButton.disabled = false;
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
