(() => {
  const i18n = globalThis.ZeroLatencyI18n;
  const defaultTranslate = (key, substitutions = [], fallback = "") =>
    i18n?.t?.(key, substitutions, fallback) || fallback || key;

  async function runHistoryDeletionTask(range, options = {}) {
    const translate =
      typeof options.translate === "function" ? options.translate : defaultTranslate;
    const renderStatus =
      typeof options.renderStatus === "function" ? options.renderStatus : null;
    const setFooterStatus =
      typeof options.setFooterStatus === "function" ? options.setFooterStatus : null;
    const result = await chrome.runtime.sendMessage({
      type: "visit-graph:delete-history-range",
      range,
    });

    if (result?.ok !== true) {
      throw new Error(result?.error || "history deletion failed");
    }

    if (
      result.taskId &&
      typeof globalThis.ZeroLatencySettingsTaskClient?.waitForTask !== "function"
    ) {
      throw new Error("background task client unavailable");
    }

    const completedTask = result.taskId
      ? await globalThis.ZeroLatencySettingsTaskClient.waitForTask(result.taskId, {
          timeoutMs: 30_000,
          onTask(task) {
            const taskMessage = task?.message || "";
            if (taskMessage) {
              renderStatus?.(taskMessage);
              setFooterStatus?.(translate("commonRemoving", [], "Removing"), taskMessage);
            }
          },
        })
      : null;
    const taskResult = completedTask?.result || result;
    const message = formatHistoryDeletionDeletedSummary(taskResult.deleted ?? {}, translate);

    return {
      result: taskResult,
      message,
    };
  }

  function formatHistoryDeletionDeletedSummary(deleted, translate = defaultTranslate) {
    const deletedTotal =
      Number(deleted.transitionMessages || 0) +
      Number(deleted.recentForegroundPages || 0) +
      Number(deleted.pageKeywords || 0) +
      Number(deleted.linkBehaviorRecords || 0);

    return translate(
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
  }

  globalThis.ZeroLatencySettingsHistoryDeletionTaskRunner = {
    runHistoryDeletionTask,
    formatHistoryDeletionDeletedSummary,
  };
})();
