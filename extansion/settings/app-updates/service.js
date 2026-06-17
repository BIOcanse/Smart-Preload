(() => {
  const constants = globalThis.ZeroLatencySettingsAppUpdateConstants;

  async function loadNativeAppUpdateStatus() {
    const response = await chrome.runtime.sendMessage({
      type: "native-app:update-status",
    });

    if (response?.ok !== true) {
      throw new Error(response?.error || "native app update status failed");
    }

    return response;
  }

  async function loadGitHubReleases() {
    const response = await fetch(constants.RELEASES_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub releases request failed with ${response.status}`);
    }

    const releases = await response.json();
    return Array.isArray(releases) ? releases : [];
  }

  async function requestNativeAppUpdate(entry) {
    const response = await chrome.runtime.sendMessage({
      type: "native-app:update-to-version",
      targetVersion: entry.version,
      assetName: entry.assetName,
      assetUrl: entry.assetUrl,
      releaseUrl: entry.releaseUrl,
    });

    if (response?.ok !== true) {
      throw new Error(response?.error || response?.message || "native app update request failed");
    }

    return response;
  }

  async function waitForNativeAppUpdateTask(taskId, options = {}) {
    if (!taskId) {
      return;
    }

    if (typeof globalThis.ZeroLatencySettingsTaskClient?.waitForTask !== "function") {
      throw new Error("background task client unavailable");
    }

    await globalThis.ZeroLatencySettingsTaskClient.waitForTask(taskId, options);
  }

  globalThis.ZeroLatencySettingsAppUpdateService = {
    loadNativeAppUpdateStatus,
    loadGitHubReleases,
    requestNativeAppUpdate,
    waitForNativeAppUpdateTask,
  };
})();
