(() => {
  const i18n = globalThis.ZeroLatencyI18n;
  const rangeApi = globalThis.ZeroLatencySettingsHistoryDeletionRange;
  const taskRunner = globalThis.ZeroLatencySettingsHistoryDeletionTaskRunner;
  const clock = globalThis.ZeroLatencySettingsHistoryDeletionClock;
  const defaultTranslate = (key, substitutions = [], fallback = "") =>
    i18n?.t?.(key, substitutions, fallback) || fallback || key;

  let controls = null;
  let translate = defaultTranslate;
  let statusCallback = null;

  function initialize(options = {}) {
    if (controls) {
      return;
    }

    translate =
      typeof options.translate === "function" ? options.translate : defaultTranslate;
    statusCallback = typeof options.setStatus === "function" ? options.setStatus : null;
    controls = {
      start: createDatePartsControl("history-delete-start"),
      end: createDatePartsControl("history-delete-end"),
      button: document.getElementById("history-delete-button"),
      status: document.getElementById("history-delete-status"),
      currentUtc: document.getElementById("history-delete-current-utc"),
    };

    controls.button?.addEventListener("click", () => {
      void handleDeleteHistoryRange();
    });

    for (const element of [
      ...Object.values(controls.start),
      ...Object.values(controls.end),
    ]) {
      element?.addEventListener("input", () => {
        renderStatus("");
      });
    }

    clock?.startUtcClock?.(controls.currentUtc);
  }

  async function handleDeleteHistoryRange() {
    const rangeResult = rangeApi.readRangeFromControls(controls, translate);

    if (!rangeResult.ok) {
      renderStatus(rangeResult.error, true);
      return;
    }

    const rangeLabel = formatRangeLabel(rangeResult.range);
    const confirmed = window.confirm(
      translate(
        "settingsHistoryDeletionConfirm",
        [rangeLabel],
        `Delete local history records for UTC range ${rangeLabel}? This cannot be undone.`
      )
    );

    if (!confirmed) {
      return;
    }

    controls.button.disabled = true;
    renderStatus(
      translate("settingsHistoryDeletionDeleting", [], "Deleting selected history records...")
    );
    setFooterStatus(
      translate("commonRemoving", [], "Removing"),
      translate("settingsHistoryDeletionDeleting", [], "Deleting selected history records...")
    );

    try {
      const result = await taskRunner.runHistoryDeletionTask(rangeResult.range, {
        translate,
        renderStatus,
        setFooterStatus,
      });

      renderStatus(result.message);
      setFooterStatus(translate("commonRemoved", [], "Removed"), result.message);
    } catch (error) {
      console.error(error);
      const message = translate(
        "settingsHistoryDeletionFailed",
        [],
        "Could not delete the selected history records."
      );
      renderStatus(message, true);
      setFooterStatus(translate("commonFailed", [], "Failed"), message);
    } finally {
      controls.button.disabled = false;
    }
  }

  function parseUtcDate(value) {
    return rangeApi.parseUtcDate(value, translate);
  }

  function formatRangeLabel(range) {
    return rangeApi.formatRangeLabel(range, translate);
  }

  function renderStatus(message, isError = false) {
    if (!controls?.status) {
      return;
    }

    const text = String(message || "").trim();
    controls.status.textContent = text;
    controls.status.classList.toggle("is-hidden", !text);
    controls.status.classList.toggle("is-info", !isError);
  }

  function setFooterStatus(title, message) {
    statusCallback?.(title, message);
  }

  function createDatePartsControl(prefix) {
    return {
      year: document.getElementById(`${prefix}-year`),
      month: document.getElementById(`${prefix}-month`),
      day: document.getElementById(`${prefix}-day`),
    };
  }

  globalThis.ZeroLatencySettingsHistoryDeletion = {
    initialize,
    parseUtcDate,
    formatRangeLabel,
  };
})();
