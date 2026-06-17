(() => {
  const i18n = globalThis.ZeroLatencyI18n;
  const t = (key, substitutions = [], fallback = "") =>
    i18n?.t?.(key, substitutions, fallback) || fallback || key;

  function createNativeAppUpdateView() {
    let controls = null;
    let statusCallback = null;
    let hasVersionOptions = false;
    let isBusy = false;

    function initialize(options = {}) {
      if (controls) {
        return true;
      }

      const nextControls = {
        select: document.getElementById("native-app-version-select"),
        refreshButton: document.getElementById("native-app-refresh-versions"),
        updateButton: document.getElementById("native-app-update-button"),
        status: document.getElementById("native-app-update-status"),
      };

      if (
        !nextControls.select ||
        !nextControls.refreshButton ||
        !nextControls.updateButton ||
        !nextControls.status
      ) {
        return false;
      }

      controls = nextControls;
      statusCallback = typeof options.setStatus === "function" ? options.setStatus : null;

      controls.refreshButton.addEventListener("click", () => {
        options.onRefresh?.();
      });
      controls.updateButton.addEventListener("click", () => {
        options.onUpdate?.();
      });
      controls.select.addEventListener("change", () => {
        options.onSelectionChange?.();
      });

      return true;
    }

    function renderVersionOptions(entries, currentVersion) {
      controls.select.textContent = "";
      hasVersionOptions = entries.length > 0;

      if (!hasVersionOptions) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = t(
          "settingsNativeAppNoVersions",
          [],
          "No app versions available"
        );
        controls.select.append(option);
        controls.select.disabled = true;
        return;
      }

      for (const entry of entries) {
        const option = document.createElement("option");
        option.value = entry.version;
        option.textContent =
          entry.version === currentVersion
            ? t(
                "settingsNativeAppCurrentVersionOption",
                [entry.version],
                `v${entry.version} (current)`
              )
            : `v${entry.version}`;
        controls.select.append(option);
      }

      controls.select.value = currentVersion;
      controls.select.disabled = isBusy;
    }

    function getSelectedVersion() {
      return controls?.select?.value || "";
    }

    function setBusy(nextBusy) {
      if (!controls) {
        return;
      }

      isBusy = nextBusy === true;
      controls.refreshButton.disabled = isBusy;
      controls.select.disabled = isBusy || !hasVersionOptions;
      controls.updateButton.disabled = true;
    }

    function setUpdateButtonEnabled(isEnabled) {
      if (!controls) {
        return;
      }

      controls.updateButton.disabled = isBusy || isEnabled !== true;
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

    return {
      initialize,
      renderVersionOptions,
      getSelectedVersion,
      setBusy,
      setUpdateButtonEnabled,
      renderStatus,
      setFooterStatus,
    };
  }

  globalThis.ZeroLatencySettingsAppUpdateView = {
    create: createNativeAppUpdateView,
  };
})();
