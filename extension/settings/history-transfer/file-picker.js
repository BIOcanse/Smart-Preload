(() => {
  const JSON_FILE_TYPES = [
    {
      description: "Smart Preload history backup",
      accept: {
        "application/json": [".json"],
      },
    },
  ];

  function createSuggestedBackupName(date = new Date()) {
    const timestamp = date
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z")
      .replace(/:/g, "-");
    return `smart-preload-history-${timestamp}.json`;
  }

  async function chooseExportFile(options = {}) {
    if (typeof globalThis.showSaveFilePicker !== "function") {
      const error = new Error("The browser does not provide a save file picker.");
      error.code = "save-picker-unavailable";
      throw error;
    }

    return globalThis.showSaveFilePicker({
      suggestedName: options.suggestedName || createSuggestedBackupName(),
      types: JSON_FILE_TYPES,
      excludeAcceptAllOption: false,
    });
  }

  async function writeExportFile(fileHandle, contents) {
    const writable = await fileHandle.createWritable();

    try {
      await writable.write(contents);
      await writable.close();
    } catch (error) {
      try {
        await writable.abort?.();
      } catch (_abortError) {
        // Preserve the original write error.
      }
      throw error;
    }
  }

  async function chooseImportFile() {
    if (typeof globalThis.showOpenFilePicker === "function") {
      const [fileHandle] = await globalThis.showOpenFilePicker({
        multiple: false,
        types: JSON_FILE_TYPES,
        excludeAcceptAllOption: false,
      });
      return fileHandle?.getFile?.() || null;
    }

    return chooseImportFileWithInput();
  }

  function chooseImportFileWithInput() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.hidden = true;

      const finish = (file = null) => {
        window.removeEventListener("focus", handleWindowFocus, true);
        input.remove();
        resolve(file);
      };
      const handleWindowFocus = () => {
        window.setTimeout(() => {
          if (!input.files?.length) {
            finish(null);
          }
        }, 0);
      };

      input.addEventListener("change", () => finish(input.files?.[0] || null), {
        once: true,
      });
      window.addEventListener("focus", handleWindowFocus, true);
      document.body.append(input);
      input.click();
    });
  }

  globalThis.ZeroLatencySettingsHistoryTransferFilePicker = {
    createSuggestedBackupName,
    chooseExportFile,
    writeExportFile,
    chooseImportFile,
  };
})();
