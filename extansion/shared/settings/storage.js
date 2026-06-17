(() => {
  const { SETTINGS_STORAGE_KEY } = globalThis.ZeroLatencySettingsSchema;
  const { DEFAULT_SETTINGS } = globalThis.ZeroLatencySettingsDefaults;

  function createSettingsStorageApi({ normalizeStoredSettings }) {
    async function loadSettings(storageArea) {
      const stored = await storageArea.get({
        [SETTINGS_STORAGE_KEY]: DEFAULT_SETTINGS,
      });

      return normalizeStoredSettings(stored[SETTINGS_STORAGE_KEY]);
    }

    async function saveSettings(storageArea, settings) {
      const normalized = normalizeStoredSettings(settings);
      await storageArea.set({
        [SETTINGS_STORAGE_KEY]: normalized,
      });
      return normalized;
    }

    return {
      loadSettings,
      saveSettings,
    };
  }

  globalThis.ZeroLatencySettingsStorage = {
    create: createSettingsStorageApi,
  };
})();
