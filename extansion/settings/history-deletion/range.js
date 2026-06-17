(() => {
  const i18n = globalThis.ZeroLatencyI18n;
  const defaultTranslate = (key, substitutions = [], fallback = "") =>
    i18n?.t?.(key, substitutions, fallback) || fallback || key;

  function readRangeFromControls(controls, translate = defaultTranslate) {
    try {
      const startDate = parseUtcDate(readUtcDateControlValue(controls?.start), translate);
      const endDate = parseUtcDate(readUtcDateControlValue(controls?.end), translate);

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

  function readUtcDateControlValue(control) {
    if (typeof control?.value === "string") {
      return control.value;
    }

    const year = String(control?.year?.value || "").trim();
    const month = String(control?.month?.value || "").trim();
    const day = String(control?.day?.value || "").trim();

    if (!year && !month && !day) {
      return "";
    }

    return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  function parseUtcDate(value, translate = defaultTranslate) {
    const trimmedValue = String(value || "").trim();

    if (!trimmedValue) {
      return null;
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmedValue);

    if (!match) {
      throwInvalidDateError(translate);
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
      throwInvalidDateError(translate);
    }

    return trimmedValue;
  }

  function throwInvalidDateError(translate) {
    throw new Error(
      translate(
        "settingsHistoryDeletionInvalidTime",
        [],
        "One of the selected UTC dates is invalid."
      )
    );
  }

  function formatRangeLabel(range, translate = defaultTranslate) {
    const startLabel = `${range.startDate} 00:00:00 UTC`;
    const endLabel = `${range.endDate} 00:00:00 UTC`;

    return translate(
      "settingsHistoryDeletionRangeLabel",
      [startLabel, endLabel],
      `[${startLabel}, ${endLabel})`
    );
  }

  globalThis.ZeroLatencySettingsHistoryDeletionRange = {
    readRangeFromControls,
    parseUtcDate,
    readUtcDateControlValue,
    formatRangeLabel,
  };
})();
