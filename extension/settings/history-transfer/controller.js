(() => {
  function createHistoryTransferController(options = {}) {
    const filePicker = options.filePicker;
    const service = options.service;
    const dialogs = options.dialogs;
    const controls = options.controls || {};
    const t =
      typeof options.translate === "function"
        ? options.translate
        : (key, substitutions = [], fallback = "") => fallback || key;
    const setStatus =
      typeof options.setStatus === "function" ? options.setStatus : () => {};
    let busy = false;

    function initialize() {
      controls.exportButton?.addEventListener("click", () => {
        void handleExport();
      });
      controls.importButton?.addEventListener("click", () => {
        void handleImport();
      });
    }

    async function handleExport() {
      if (busy) {
        return;
      }

      setBusy(true);
      try {
        const confirmed = await dialogs.confirm({
          title: t(
            "settingsHistoryExportWarningTitle",
            [],
            "Review privacy before exporting"
          ),
          message: t(
            "settingsHistoryExportWarningMessage",
            [],
            "The backup can contain visited addresses, page titles, keywords, transitions, and usage statistics."
          ),
          detail: t(
            "settingsHistoryExportWarningDetail",
            [],
            "Do not share it casually. You are responsible for any personal information exposed by sharing the file."
          ),
          confirmLabel: t("settingsHistoryExportContinue", [], "Choose save location"),
          variant: "warning",
        });

        if (!confirmed) {
          return;
        }

        const fileHandle = await filePicker.chooseExportFile({
          suggestedName: filePicker.createSuggestedBackupName(),
        });
        setTransferStatus(
          t("settingsHistoryExportPreparing", [], "Preparing history backup...")
        );
        setStatus(
          t("commonExporting", [], "Exporting"),
          t("settingsHistoryExportPreparing", [], "Preparing history backup...")
        );

        const response = await service.exportHistory();
        const contents = `${JSON.stringify(response.backup, null, 2)}\n`;
        await filePicker.writeExportFile(fileHandle, contents);
        const fileName = fileHandle.name || filePicker.createSuggestedBackupName();
        const message = t(
          "settingsHistoryExportSucceeded",
          [fileName],
          `History was exported to ${fileName}.`
        );
        setTransferStatus(message);
        setStatus(t("commonExported", [], "Exported"), message);
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        console.error(error);
        const message =
          error?.code === "save-picker-unavailable"
            ? t(
                "settingsHistorySavePickerUnavailable",
                [],
                "This browser cannot choose a save location from the settings page."
              )
            : t(
                "settingsHistoryExportFailed",
                [],
                "Could not export history."
              );
        setTransferStatus(message, true);
        setStatus(t("commonFailed", [], "Failed"), message);
      } finally {
        setBusy(false);
      }
    }

    async function handleImport() {
      if (busy) {
        return;
      }

      setBusy(true);
      try {
        const file = await filePicker.chooseImportFile();
        if (!file) {
          return;
        }

        setTransferStatus(
          t("settingsHistoryImportValidating", [], "Validating history backup...")
        );
        setStatus(
          t("commonImporting", [], "Importing"),
          t("settingsHistoryImportValidating", [], "Validating history backup...")
        );

        const backup = await file.text();
        const validation = await service.validateImport(backup);

        const confirmed = await dialogs.confirm({
          title: t(
            "settingsHistoryImportConfirmTitle",
            [],
            "Replace existing history?"
          ),
          message: t(
            "settingsHistoryImportConfirmMessage",
            [],
            "Importing this file will completely replace the current historical records. This cannot be undone."
          ),
          detail: formatImportSummary(validation, t),
          confirmLabel: t("settingsHistoryImportConfirm", [], "Replace and import"),
          confirmClassName: "danger-button",
          variant: "danger",
        });

        if (!confirmed) {
          const message = t(
            "settingsHistoryImportCancelled",
            [],
            "Import was cancelled. Existing history was not changed."
          );
          setTransferStatus(message);
          setStatus(t("commonReady", [], "Ready"), message);
          return;
        }

        setBusy(true);
        setTransferStatus(
          t("settingsHistoryImporting", [], "Replacing history records...")
        );
        const result = await service.importHistory(backup);
        const message = t(
          "settingsHistoryImportSucceeded",
          [result.summary?.transitionMessages ?? 0],
          `Imported ${result.summary?.transitionMessages ?? 0} transition records.`
        );
        setTransferStatus(message);
        setStatus(t("commonImported", [], "Imported"), message);
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        console.error(error);
        const message = t(
          "settingsHistoryImportFailed",
          [],
          "The selected file is not a valid Smart Preload history backup or could not be imported."
        );
        setTransferStatus(message, true);
        setStatus(t("commonFailed", [], "Failed"), message);
      } finally {
        setBusy(false);
      }
    }

    function setBusy(nextBusy) {
      busy = nextBusy === true;
      if (controls.exportButton) {
        controls.exportButton.disabled = busy;
      }
      if (controls.importButton) {
        controls.importButton.disabled = busy;
      }
    }

    function setTransferStatus(message, isError = false) {
      if (!controls.status) {
        return;
      }
      const text = String(message || "").trim();
      controls.status.textContent = text;
      controls.status.classList.toggle("is-hidden", !text);
      controls.status.classList.toggle("is-info", !isError);
    }

    return {
      initialize,
      handleExport,
      handleImport,
    };
  }

  function formatImportSummary(validation, translate) {
    const metadata = validation?.metadata || {};
    const summary = validation?.summary || {};
    const exportedAt = String(metadata.exportedAt || "-");

    return translate(
      "settingsHistoryImportSummary",
      [
        exportedAt,
        summary.transitionMessages ?? 0,
        summary.sites ?? 0,
        summary.pageKeywords ?? 0,
      ],
      `Backup time: ${exportedAt}. ${summary.transitionMessages ?? 0} transitions, ${summary.sites ?? 0} sites, ${summary.pageKeywords ?? 0} keyword records.`
    );
  }

  function isAbortError(error) {
    return error?.name === "AbortError";
  }

  globalThis.ZeroLatencySettingsHistoryTransferController = {
    create: createHistoryTransferController,
    formatImportSummary,
    isAbortError,
  };
})();
