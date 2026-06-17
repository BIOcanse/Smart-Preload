(function () {
  const MAX_TASK_LOGS = 24;
  const MAX_RECENT_LOGS = 160;
  const recentLogs = [];
  const { normalizeTaskStoreText } = globalThis.ZeroLatencyBackgroundTaskStoreUtils;

  function appendTaskLog(task, event, level, message) {
    const entry = {
      taskId: task.taskId,
      event: normalizeTaskStoreText(event) || "log",
      level: normalizeTaskStoreText(level) || "info",
      message: normalizeTaskStoreText(message),
      createdAt: new Date().toISOString(),
    };
    task.logs.push(entry);
    if (task.logs.length > MAX_TASK_LOGS) {
      task.logs.splice(0, task.logs.length - MAX_TASK_LOGS);
    }
    recentLogs.push(entry);
    if (recentLogs.length > MAX_RECENT_LOGS) {
      recentLogs.splice(0, recentLogs.length - MAX_RECENT_LOGS);
    }
    task.updatedAt = entry.createdAt;
  }

  function getRecentTaskLogsSnapshot() {
    return recentLogs.slice(-MAX_RECENT_LOGS).map((entry) => ({ ...entry }));
  }

  globalThis.ZeroLatencyBackgroundTaskStoreLogs = {
    appendTaskLog,
    getRecentTaskLogsSnapshot,
  };
})();
