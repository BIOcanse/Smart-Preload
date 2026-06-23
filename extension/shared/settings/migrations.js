(function () {
  const {
    cloneSettings,
    isPlainObject,
  } = globalThis.ZeroLatencySettingsUtils;
  const {
    SETTINGS_STORAGE_VERSION,
  } = globalThis.ZeroLatencySettingsSchema;
  const { DEFAULT_SETTINGS } = globalThis.ZeroLatencySettingsDefaults;

  const ATTENTION_ACTIVITY_SETTINGS_VERSION = 31;
  const LEGACY_DEFAULT_ATTENTION_POOL_HOURS = 5;
  const LEGACY_DEFAULT_ATTENTION_INPUT_WINDOW_SECONDS = 60;
  const LEGACY_DEFAULT_ATTENTION_MEDIA_PLAYBACK_WEIGHT = 0.2;
  const LEGACY_DEFAULT_ATTENTION_AUDIO_PLAYBACK_WEIGHT = 0.07;

  function migrateStoredSettingsToCurrentVersion(value) {
    if (!isPlainObject(value)) {
      return value;
    }

    let migratedValue = cloneSettings(value);
    const storedVersion = readStoredSettingsVersion(value);

    if (
      storedVersion !== null &&
      storedVersion < ATTENTION_ACTIVITY_SETTINGS_VERSION
    ) {
      migratedValue = migrateAttentionActivitySettingsToVersion31(migratedValue);
    }

    migratedValue.version = SETTINGS_STORAGE_VERSION;
    return migratedValue;
  }

  function readStoredSettingsVersion(value) {
    const version = Number(value?.version);
    return Number.isFinite(version) ? version : null;
  }

  function migrateAttentionActivitySettingsToVersion31(settings) {
    const preloading = settings.preloading;

    if (!isPlainObject(preloading) || !isPlainObject(preloading.scheduler)) {
      return settings;
    }

    const scheduler = { ...preloading.scheduler };

    if (!hasOwn(scheduler, "attentionPoolMinutes")) {
      const legacyHours = Number(scheduler.attentionPoolHours);
      scheduler.attentionPoolMinutes =
        Number.isFinite(legacyHours) &&
        legacyHours > 0 &&
        legacyHours !== LEGACY_DEFAULT_ATTENTION_POOL_HOURS
          ? legacyHours * 60
          : DEFAULT_SETTINGS.preloading.scheduler.attentionPoolMinutes;
    }

    delete scheduler.attentionPoolHours;

    migrateLegacyDefaultNumber(
      scheduler,
      "attentionInputWindowSeconds",
      LEGACY_DEFAULT_ATTENTION_INPUT_WINDOW_SECONDS,
      DEFAULT_SETTINGS.preloading.scheduler.attentionInputWindowSeconds
    );
    migrateLegacyDefaultNumber(
      scheduler,
      "attentionMediaPlaybackWeight",
      LEGACY_DEFAULT_ATTENTION_MEDIA_PLAYBACK_WEIGHT,
      DEFAULT_SETTINGS.preloading.scheduler.attentionMediaPlaybackWeight
    );
    migrateLegacyDefaultNumber(
      scheduler,
      "attentionAudioPlaybackWeight",
      LEGACY_DEFAULT_ATTENTION_AUDIO_PLAYBACK_WEIGHT,
      DEFAULT_SETTINGS.preloading.scheduler.attentionAudioPlaybackWeight
    );

    return {
      ...settings,
      preloading: {
        ...preloading,
        scheduler,
      },
    };
  }

  function migrateLegacyDefaultNumber(settings, key, legacyDefault, currentDefault) {
    if (!hasOwn(settings, key) || Number(settings[key]) === legacyDefault) {
      settings[key] = currentDefault;
    }
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value || {}, key);
  }

  globalThis.ZeroLatencySettingsMigrations = {
    migrateStoredSettingsToCurrentVersion,
    migrateAttentionActivitySettingsToVersion31,
  };
})();
