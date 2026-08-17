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

    const storedVersion = readStoredSettingsVersion(value);

    // 来自更新版本的设置：原样返回，不迁移也不改写 version。
    // 此前没有这个分支，回退到旧版会把更新版本号盖成当前版本，销毁“这份数据来自
    // 未来”的唯一信号；再次升级时新版本会把已经迁移过的数据当成旧数据重跑迁移。
    if (storedVersion !== null && storedVersion > SETTINGS_STORAGE_VERSION) {
      return value;
    }

    let migratedValue = cloneSettings(value);

    // version 缺失或非数值时不跑迁移，只盖章为当前版本。这是有意行为，由
    // preload-scheduler-selections.mjs:276 固定：没有 version 的存储数据按“已是当前
    // 结构”处理，其字段值原样保留。代价是真正的远古数据若丢了 version，其遗留字段
    // （如 attentionPoolHours）不会被转换——要覆盖那种情况需要按字段形状探测版本，
    // 而不是放宽这里的判断。
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

  // 键缺失，或当前值仍等于旧默认值时，采用新默认值。
  //
  // 已知取舍，不是疏漏：设置每次保存都会把整个对象写回存储，所以每个键都存在，无论
  // 用户有没有动过它。因此这里无法区分“从没动过”和“明确选成了恰好等于旧默认值的值”，
  // 后者会被改写（输入窗口 60 秒 → 30、视频权重 0.2 → 0、音频权重 0.07 → 0）。
  // 现行语义是有意选择的，并由 scripts/testing/preload-scheduler-selections.mjs:175
  // 固定下来：让停留在旧默认值上的用户跟随新默认值。
  //
  // 要同时保住显式选择，需要 provenance（记录哪些键是用户显式写入的），属于设置写入
  // 路径的改动，不在本函数范围内。
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
