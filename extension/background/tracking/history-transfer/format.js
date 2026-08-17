(function () {
  const HISTORY_BACKUP_FORMAT = "smart-preload-history";
  const HISTORY_BACKUP_FORMAT_VERSION = 1;

  function createHistoryBackup(graph, options = {}) {
    const exportedAt = normalizeIsoTimestamp(options.exportedAt) || new Date().toISOString();
    const extensionVersion = String(options.extensionVersion || "").trim();
    const snapshot = cloneJsonValue(graph);

    return {
      format: HISTORY_BACKUP_FORMAT,
      formatVersion: HISTORY_BACKUP_FORMAT_VERSION,
      exportedAt,
      extensionVersion,
      history: {
        graph: snapshot,
      },
      summary: buildHistoryBackupSummary(snapshot),
    };
  }

  function parseHistoryBackup(rawBackup) {
    const backup = parseBackupValue(rawBackup);

    if (!isPlainObject(backup)) {
      throw createHistoryBackupError("invalid-backup", "History backup must be a JSON object.");
    }
    if (backup.format !== HISTORY_BACKUP_FORMAT) {
      throw createHistoryBackupError(
        "unsupported-format",
        "The selected file is not a Smart Preload history backup."
      );
    }
    if (backup.formatVersion !== HISTORY_BACKUP_FORMAT_VERSION) {
      throw createHistoryBackupError(
        "unsupported-version",
        `Unsupported history backup format version: ${String(backup.formatVersion)}`
      );
    }
    if (!normalizeIsoTimestamp(backup.exportedAt)) {
      throw createHistoryBackupError(
        "invalid-export-time",
        "History backup export time is invalid."
      );
    }
    if (!isPlainObject(backup.history) || !isPlainObject(backup.history.graph)) {
      throw createHistoryBackupError(
        "missing-history",
        "History backup does not contain a visit graph."
      );
    }

    const graphInput = cloneJsonValue(backup.history.graph);
    const previousTransitionSequence = clampNonNegativeInt(
      graphInput.transitionSequence,
      0
    );

    // A backup carries complete messages. Rebuild current derived indexes instead of
    // trusting indexes produced by another extension version.
    graphInput.version = 0;
    delete graphInput.persistenceMode;

    // **归一化戳也必须清掉**，否则一份带着匹配戳的备份会直接命中 normalizeTrackingGraph
    // 的最快路径，整体跳过重建 —— 那正是这里强制 version = 0 想要阻止的事。备份里的
    // transitionMessageBuckets / pageTransitionMessageBuckets 是调用方提供的任意结构，
    // 必须由本机重新构造，不能拿戳当信任凭证（戳只能证明「谁写的」，而备份文件里的
    // 戳来自文件本身，不是本机写的）。
    delete graphInput.normalizedBy;
    const graph = normalizeTrackingGraph(graphInput);
    globalThis.ZeroLatencyTrackingHistoryDeletion.rebuildDerivedTrackingHistoryIndexes(
      graph,
      {
        previousTransitionSequence,
        updatedAt: new Date().toISOString(),
      }
    );

    return {
      graph,
      metadata: {
        exportedAt: backup.exportedAt,
        extensionVersion:
          typeof backup.extensionVersion === "string" ? backup.extensionVersion : "",
        formatVersion: HISTORY_BACKUP_FORMAT_VERSION,
      },
      summary: buildHistoryBackupSummary(graph),
    };
  }

  function buildHistoryBackupSummary(graph) {
    const counts = buildHistoryDeletionCounts(graph);

    return {
      transitionMessages: counts.transitionMessageCount,
      sites: Object.keys(graph?.nodes || {}).length,
      routes: counts.edgeCount,
      recentForegroundPages: counts.recentForegroundPageCount,
      pageKeywords: counts.pageKeywordCount,
      linkBehaviorRecords: counts.linkBehaviorRecordCount,
    };
  }

  function parseBackupValue(rawBackup) {
    if (typeof rawBackup !== "string") {
      return rawBackup;
    }

    try {
      return JSON.parse(rawBackup);
    } catch {
      throw createHistoryBackupError("invalid-json", "History backup is not valid JSON.");
    }
  }

  function normalizeIsoTimestamp(value) {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }

    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  }

  function cloneJsonValue(value) {
    if (typeof structuredClone === "function") {
      return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value));
  }

  function createHistoryBackupError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  globalThis.ZeroLatencyTrackingHistoryTransferFormat = {
    HISTORY_BACKUP_FORMAT,
    HISTORY_BACKUP_FORMAT_VERSION,
    createHistoryBackup,
    parseHistoryBackup,
    buildHistoryBackupSummary,
  };
})();
