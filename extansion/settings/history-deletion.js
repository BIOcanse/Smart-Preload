(() => {
  const i18n = globalThis.ZeroLatencyI18n;
  const defaultTranslate = (key, substitutions = [], fallback = "") =>
    i18n?.t?.(key, substitutions, fallback) || fallback || key;

  let controls = null;
  let translate = defaultTranslate;
  let statusCallback = null;
  let utcClockTimerId = null;

  function initialize(options = {}) {
    if (controls) {
      return;
    }

    translate =
      typeof options.translate === "function" ? options.translate : defaultTranslate;
    statusCallback = typeof options.setStatus === "function" ? options.setStatus : null;
    controls = {
      start: document.getElementById("history-delete-start"),
      end: document.getElementById("history-delete-end"),
      button: document.getElementById("history-delete-button"),
      status: document.getElementById("history-delete-status"),
      currentUtc: document.getElementById("history-delete-current-utc"),
    };

    controls.button?.addEventListener("click", () => {
      void handleDeleteHistoryRange();
    });

    for (const element of [controls.start, controls.end]) {
      element?.addEventListener("input", () => {
        renderStatus("");
      });
    }

    startUtcClock();
  }

  async function handleDeleteHistoryRange() {
    const rangeResult = readRangeFromControls();

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
      const result = await chrome.runtime.sendMessage({
        type: "visit-graph:delete-history-range",
        range: rangeResult.range,
      });

      if (result?.ok !== true) {
        throw new Error(result?.error || "history deletion failed");
      }

      const deleted = result.deleted ?? {};
      const deletedTotal =
        Number(deleted.transitionMessages || 0) +
        Number(deleted.recentForegroundPages || 0) +
        Number(deleted.pageKeywords || 0) +
        Number(deleted.linkBehaviorRecords || 0);
      const message = translate(
        "settingsHistoryDeletionDeletedSummary",
        [
          String(deletedTotal),
          String(deleted.transitionMessages || 0),
          String(deleted.recentForegroundPages || 0),
          String(deleted.pageKeywords || 0),
          String(deleted.linkBehaviorRecords || 0),
        ],
        `Deleted ${deletedTotal} history record(s): ${deleted.transitionMessages || 0} transitions, ${deleted.recentForegroundPages || 0} foreground pages, ${deleted.pageKeywords || 0} keyword records, ${deleted.linkBehaviorRecords || 0} link behavior records.`
      );

      renderStatus(message);
      setFooterStatus(translate("commonRemoved", [], "Removed"), message);
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

  function readRangeFromControls() {
    try {
      const startDate = parseUtcDate(controls.start?.value || "");
      const endDate = parseUtcDate(controls.end?.value || "");

      if (!startDate || !endDate) {
        return {
          ok: false,
          error: translate(
            "settingsHistoryDeletionNeedRange",
            [],
            "Select both UTC start date and UTC end date."
          ),
        };
      }

      if (startDate >= endDate) {
        return {
          ok: false,
          error: translate(
            "settingsHistoryDeletionInvalidRange",
            [],
            "UTC start date must be earlier than UTC end date."
          ),
        };
      }

      return {
        ok: true,
        range: {
          startDate,
          endDate,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function parseUtcDate(value) {
    const trimmedValue = String(value || "").trim();

    if (!trimmedValue) {
      return null;
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmedValue);

    if (!match) {
      throwInvalidDateError();
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const timestamp = Date.UTC(year, month - 1, day);
    const parsed = new Date(timestamp);

    if (
      parsed.getUTCFullYear() !== year ||
      parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day
    ) {
      throwInvalidDateError();
    }

    return trimmedValue;
  }

  function throwInvalidDateError() {
    throw new Error(
      translate(
        "settingsHistoryDeletionInvalidTime",
        [],
        "One of the selected UTC dates is invalid."
      )
    );
  }

  function formatRangeLabel(range) {
    const startLabel = `${range.startDate} 00:00:00 UTC`;
    const endLabel = `${range.endDate} 00:00:00 UTC`;

    return translate(
      "settingsHistoryDeletionRangeLabel",
      [startLabel, endLabel],
      `[${startLabel}, ${endLabel})`
    );
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

  function startUtcClock() {
    if (!controls?.currentUtc || utcClockTimerId !== null) {
      return;
    }

    updateUtcClock();
    utcClockTimerId = window.setInterval(updateUtcClock, 1000);
  }

  function updateUtcClock() {
    if (!controls?.currentUtc) {
      return;
    }

    controls.currentUtc.textContent = new Date()
      .toISOString()
      .replace("T", " ")
      .replace("Z", " UTC");
  }

  function setFooterStatus(title, message) {
    statusCallback?.(title, message);
  }

  globalThis.ZeroLatencySettingsHistoryDeletion = {
    initialize,
    parseUtcDate,
    formatRangeLabel,
  };
})();
