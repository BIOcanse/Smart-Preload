(function () {
  const {
    TASK_STATUSES,
    cloneJsonValue,
  } = globalThis.ZeroLatencyBackgroundTaskModel;
  const { appendTaskLog } = globalThis.ZeroLatencyBackgroundTaskStoreLogs;

  function markTaskRunning(task) {
    const startedAt = new Date().toISOString();
    task.status = TASK_STATUSES.RUNNING;
    task.step = "running";
    task.message = "Task running.";
    task.startedAt = startedAt;
    task.updatedAt = startedAt;
    appendTaskLog(task, "started", "info", "Task started.");
  }

  function markTaskCompleted(task, result) {
    const completedAt = new Date().toISOString();
    task.status = TASK_STATUSES.COMPLETED;
    task.step = "completed";
    task.message = "Task completed.";
    task.progress = {
      ...task.progress,
      percent: 100,
    };
    task.result = cloneJsonValue(result ?? { ok: true });
    task.completedAt = completedAt;
    task.updatedAt = completedAt;
    appendTaskLog(task, "completed", "info", "Task completed.");
  }

  function markTaskFailed(task, error) {
    const completedAt = new Date().toISOString();
    task.status = TASK_STATUSES.FAILED;
    task.step = "failed";
    task.message = error instanceof Error ? error.message : String(error);
    task.error = task.message;
    task.completedAt = completedAt;
    task.updatedAt = completedAt;
    appendTaskLog(task, "failed", "error", task.message);
  }

  globalThis.ZeroLatencyBackgroundTaskStoreLifecycle = {
    markTaskRunning,
    markTaskCompleted,
    markTaskFailed,
  };
})();
