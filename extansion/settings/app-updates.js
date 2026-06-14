(() => {
  const RELEASES_API_URL =
    "https://api.github.com/repos/BIOcanse/Smart-Preload/releases?per_page=50";
  const RELEASES_PAGE_URL =
    "https://github.com/BIOcanse/Smart-Preload/releases";
  const APP_ASSET_NAME_PREFIX = "zero-latency-web-app-windows-x64-v";
  const APP_ASSET_NAME_SUFFIX = ".zip";

  const i18n = globalThis.ZeroLatencyI18n;
  const t = (key, substitutions = [], fallback = "") =>
    i18n?.t?.(key, substitutions, fallback) || fallback || key;

  let controls = null;
  let catalog = [];
  let statusCallback = null;

  function initialize(options = {}) {
    if (controls) {
      return;
    }

    controls = {
      select: document.getElementById("native-app-version-select"),
      refreshButton: document.getElementById("native-app-refresh-versions"),
      updateButton: document.getElementById("native-app-update-button"),
      status: document.getElementById("native-app-update-status"),
    };
    statusCallback = typeof options.setStatus === "function" ? options.setStatus : null;

    if (!controls.select || !controls.refreshButton || !controls.updateButton || !controls.status) {
      return;
    }

    controls.refreshButton.addEventListener("click", () => {
      void refreshVersionCatalog();
    });
    controls.updateButton.addEventListener("click", () => {
      void requestSelectedAppUpdate();
    });
    controls.select.addEventListener("change", syncUpdateButton);

    void refreshVersionCatalog();
  }

  async function refreshVersionCatalog() {
    setBusy(true);
    renderStatus(t("settingsNativeAppVersionsLoading", [], "Loading versions..."));
    setFooterStatus(
      t("commonLoading", [], "Loading"),
      t("settingsNativeAppVersionsLoading", [], "Loading versions...")
    );

    try {
      const appStatus = await loadNativeAppUpdateStatus();
      const currentVersion = normalizeVersion(appStatus.currentVersion);

      if (!currentVersion) {
        throw new Error(t("settingsNativeAppVersionUnknown", [], "Native app version is unavailable."));
      }

      const releases = await loadGitHubReleases();
      catalog = buildUpgradeableCatalog(releases, currentVersion);
      renderVersionOptions(catalog, currentVersion);

      if (catalog.some((entry) => compareVersions(entry.version, currentVersion) > 0)) {
        renderStatus(
          t(
            "settingsNativeAppVersionsReady",
            [currentVersion],
            `Native app ${currentVersion}. Select a newer version to upgrade.`
          )
        );
        setFooterStatus(
          t("commonReady", [], "Ready"),
          t(
            "settingsNativeAppVersionsReady",
            [currentVersion],
            `Native app ${currentVersion}. Select a newer version to upgrade.`
          )
        );
      } else {
        renderStatus(
          t(
            "settingsNativeAppNoUpgrade",
            [currentVersion],
            `Native app ${currentVersion} is already on the latest listed version.`
          )
        );
        setFooterStatus(
          t("commonReady", [], "Ready"),
          t(
            "settingsNativeAppNoUpgrade",
            [currentVersion],
            `Native app ${currentVersion} is already on the latest listed version.`
          )
        );
      }
    } catch (error) {
      console.error(error);
      catalog = [];
      renderVersionOptions([], "");
      const message = t(
        "settingsNativeAppVersionsFailed",
        [RELEASES_PAGE_URL],
        "Could not load app versions. Start the native app or use GitHub releases."
      );
      renderStatus(message, true);
      setFooterStatus(t("commonFailed", [], "Failed"), message);
    } finally {
      setBusy(false);
    }
  }

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
    const response = await fetch(RELEASES_API_URL, {
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

  function buildUpgradeableCatalog(releases, currentVersion) {
    const entriesByVersion = new Map();

    entriesByVersion.set(currentVersion, {
      version: currentVersion,
      current: true,
      releaseUrl: RELEASES_PAGE_URL,
      assetName: "",
      assetUrl: "",
    });

    for (const release of releases) {
      if (release?.draft === true || release?.prerelease === true) {
        continue;
      }

      const version = normalizeVersion(release?.tag_name || release?.name);
      if (!version || compareVersions(version, currentVersion) < 0) {
        continue;
      }

      const assetName = `${APP_ASSET_NAME_PREFIX}${version}${APP_ASSET_NAME_SUFFIX}`;
      const asset = Array.isArray(release?.assets)
        ? release.assets.find((candidate) => candidate?.name === assetName)
        : null;

      if (!asset?.browser_download_url) {
        continue;
      }

      entriesByVersion.set(version, {
        version,
        current: version === currentVersion,
        releaseUrl: release.html_url || RELEASES_PAGE_URL,
        releaseName: release.name || release.tag_name || `v${version}`,
        assetName,
        assetUrl: asset.browser_download_url,
      });
    }

    return [...entriesByVersion.values()].sort((left, right) =>
      compareVersions(left.version, right.version)
    );
  }

  function renderVersionOptions(entries, currentVersion) {
    controls.select.textContent = "";

    if (entries.length === 0) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = t("settingsNativeAppNoVersions", [], "No app versions available");
      controls.select.append(option);
      controls.select.disabled = true;
      syncUpdateButton();
      return;
    }

    for (const entry of entries) {
      const option = document.createElement("option");
      option.value = entry.version;
      option.textContent =
        entry.version === currentVersion
          ? t("settingsNativeAppCurrentVersionOption", [entry.version], `v${entry.version} (current)`)
          : `v${entry.version}`;
      controls.select.append(option);
    }

    controls.select.value = currentVersion;
    controls.select.disabled = false;
    syncUpdateButton();
  }

  async function requestSelectedAppUpdate() {
    const entry = getSelectedCatalogEntry();

    if (!entry || entry.current || !entry.assetUrl) {
      syncUpdateButton();
      return;
    }

    const confirmed = window.confirm(
      t(
        "settingsNativeAppUpdateConfirm",
        [entry.version],
        `Upgrade the native app to v${entry.version}? The app will restart after the update starts.`
      )
    );

    if (!confirmed) {
      return;
    }

    setBusy(true);
    renderStatus(
      t("settingsNativeAppUpdateStarting", [entry.version], `Starting native app update to v${entry.version}...`)
    );
    setFooterStatus(
      t("commonSaving", [], "Saving"),
      t("settingsNativeAppUpdateStarting", [entry.version], `Starting native app update to v${entry.version}...`)
    );

    try {
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

      const message = t(
        "settingsNativeAppUpdateAccepted",
        [entry.version],
        `Native app update to v${entry.version} has started.`
      );
      renderStatus(message);
      setFooterStatus(t("commonReady", [], "Ready"), message);
    } catch (error) {
      console.error(error);
      const message = t(
        "settingsNativeAppUpdateFailed",
        [entry.version],
        `Could not start native app update to v${entry.version}.`
      );
      renderStatus(message, true);
      setFooterStatus(t("commonFailed", [], "Failed"), message);
    } finally {
      setBusy(false);
    }
  }

  function getSelectedCatalogEntry() {
    const version = normalizeVersion(controls.select.value);
    return catalog.find((entry) => entry.version === version) ?? null;
  }

  function syncUpdateButton() {
    const entry = getSelectedCatalogEntry();
    controls.updateButton.disabled = !entry || entry.current || !entry.assetUrl;
  }

  function setBusy(isBusy) {
    if (!controls) {
      return;
    }

    controls.refreshButton.disabled = isBusy;
    controls.updateButton.disabled = isBusy || controls.updateButton.disabled;
    controls.select.disabled = isBusy || catalog.length === 0;

    if (!isBusy) {
      syncUpdateButton();
    }
  }

  function renderStatus(message, isError = false) {
    const text = String(message || "").trim();
    controls.status.textContent = text;
    controls.status.classList.toggle("is-hidden", !text);
    controls.status.classList.toggle("is-info", !isError);
  }

  function setFooterStatus(title, message) {
    statusCallback?.(title, message);
  }

  function normalizeVersion(value) {
    const text = String(value || "")
      .trim()
      .replace(/^v/iu, "");
    return /^\d+\.\d+\.\d+$/u.test(text) ? text : "";
  }

  function compareVersions(left, right) {
    const leftParts = String(left || "").split(".").map((part) => Number(part) || 0);
    const rightParts = String(right || "").split(".").map((part) => Number(part) || 0);

    for (let index = 0; index < 3; index += 1) {
      if (leftParts[index] !== rightParts[index]) {
        return leftParts[index] - rightParts[index];
      }
    }

    return 0;
  }

  globalThis.ZeroLatencySettingsAppUpdates = {
    initialize,
    normalizeVersion,
    compareVersions,
    buildUpgradeableCatalog,
  };
})();
