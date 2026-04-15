const pageLabelElement = document.getElementById("page-label");
const nodeCountElement = document.getElementById("node-count");
const edgeCountElement = document.getElementById("edge-count");
const updatedAtElement = document.getElementById("updated-at");
const topDestinationsElement = document.getElementById("top-edges");
const topDestinationsEmptyElement = document.getElementById("top-edges-empty");
const preloadListElement = document.getElementById("preload-list");
const preloadListEmptyElement = document.getElementById("preload-list-empty");
const refreshButton = document.getElementById("refresh-button");
const settingsButton = document.getElementById("settings-button");
const statusTextElement = document.getElementById("status-text");

refreshButton.addEventListener("click", () => {
  void loadSnapshot();
});

settingsButton.addEventListener("click", async () => {
  try {
    await chrome.tabs.create({
      url: chrome.runtime.getURL("settings/index.html"),
    });
    window.close();
  } catch (error) {
    console.error(error);

    try {
      await chrome.runtime.openOptionsPage();
      window.close();
    } catch (fallbackError) {
      console.error(fallbackError);
      statusTextElement.textContent = "Failed to open settings page.";
    }
  }
});

void loadSnapshot();

async function loadSnapshot() {
  setBusy(true, "Loading visit graph...");

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
    setBusy(false, "Visit graph loaded.");
  } catch (error) {
    console.error(error);
    setBusy(false, "Failed to load visit graph.");
  }
}

function renderSnapshot(snapshot) {
  nodeCountElement.textContent = String(snapshot?.summary?.nodeCount ?? 0);
  edgeCountElement.textContent = String(snapshot?.summary?.edgeCount ?? 0);
  updatedAtElement.textContent = formatUpdatedAt(snapshot?.summary?.updatedAt);
  pageLabelElement.textContent = snapshot?.pageContext?.trackable
    ? snapshot?.pageContext?.pageLabel || "Current page"
    : "Current page is not tracked";

  renderTopDestinations(snapshot?.currentTopDestinations ?? []);
  renderPreloadList(snapshot?.currentPreloads ?? [], snapshot?.pageContext);
}

function renderTopDestinations(topDestinations) {
  topDestinationsElement.textContent = "";

  if (!topDestinations.length) {
    topDestinationsEmptyElement.classList.remove("hidden");
    return;
  }

  topDestinationsEmptyElement.classList.add("hidden");

  for (const destination of topDestinations.slice(0, 3)) {
    const item = document.createElement("li");
    item.className = "list-item";

    const title = document.createElement("p");
    title.className = "item-title";
    title.textContent =
      destination.destinationLabel || destination.destinationHost || "Unknown";

    const meta = document.createElement("p");
    meta.className = "item-meta";
    meta.textContent = `From this page: ${destination.count} | Last: ${formatTimestamp(
      destination.lastSeenAt
    )} | Type: ${destination.lastTransitionType}`;

    item.append(title, meta);
    topDestinationsElement.append(item);
  }
}

function renderPreloadList(preloads, pageContext) {
  preloadListElement.textContent = "";

  if (!preloads.length) {
    preloadListEmptyElement.classList.remove("hidden");
    preloadListEmptyElement.textContent = pageContext?.hasPreloadWindow
      ? "No preload targets prepared for this page."
      : "No preload window yet.";
    return;
  }

  preloadListEmptyElement.classList.add("hidden");

  for (const preload of preloads.slice(0, 3)) {
    const item = document.createElement("li");
    item.className = "list-item";

    const title = document.createElement("p");
    title.className = "item-title";
    title.textContent = preload.nodeLabel;

    const meta = document.createElement("p");
    meta.className = "item-meta";
    meta.textContent = `${preload.strategy || "hidden-tab"} | ${preload.status} | Score: ${preload.score} | ${truncateUrl(
      preload.loadedUrl || preload.requestedUrl
    )}`;

    item.append(title, meta);
    preloadListElement.append(item);
  }
}

function setBusy(isBusy, message) {
  refreshButton.disabled = isBusy;
  statusTextElement.textContent = message;
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
