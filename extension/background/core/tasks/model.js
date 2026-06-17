(function () {
  const TASK_STATUSES = {
    QUEUED: "queued",
    RUNNING: "running",
    COMPLETED: "completed",
    FAILED: "failed",
    CANCELED: "canceled",
  };
  const TERMINAL_STATUSES = new Set([
    TASK_STATUSES.COMPLETED,
    TASK_STATUSES.FAILED,
    TASK_STATUSES.CANCELED,
  ]);

  function isTerminalTaskStatus(status) {
    return TERMINAL_STATUSES.has(String(status || "").toLowerCase());
  }

  function cloneBackgroundTaskRecord(task) {
    if (!task) {
      return null;
    }

    return {
      taskId: task.taskId,
      kind: task.kind,
      queueId: task.queueId,
      title: task.title,
      description: task.description,
      dedupeKey: task.dedupeKey,
      status: task.status,
      step: task.step,
      message: task.message,
      progress: cloneJsonValue(task.progress || {}),
      result: cloneJsonValue(task.result ?? null),
      error: task.error || "",
      createdAt: task.createdAt,
      queuedAt: task.queuedAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      updatedAt: task.updatedAt,
      logs: Array.isArray(task.logs) ? task.logs.map((entry) => ({ ...entry })) : [],
    };
  }

  function cloneJsonValue(value) {
    if (value === null || value === undefined) {
      return value ?? null;
    }

    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      return null;
    }
  }

  globalThis.ZeroLatencyBackgroundTaskModel = {
    TASK_STATUSES,
    isTerminalTaskStatus,
    cloneBackgroundTaskRecord,
    cloneJsonValue,
  };
})();
