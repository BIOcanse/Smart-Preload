(function () {
  const {
    TASK_STATUSES,
    isTerminalTaskStatus,
    cloneBackgroundTaskRecord,
    cloneJsonValue,
  } = globalThis.ZeroLatencyBackgroundTaskModel;
  const { normalizeTaskStoreText } = globalThis.ZeroLatencyBackgroundTaskStoreUtils;
  const {
    appendTaskLog,
    getRecentTaskLogsSnapshot,
  } = globalThis.ZeroLatencyBackgroundTaskStoreLogs;
  const {
    markTaskRunning,
    markTaskCompleted,
    markTaskFailed,
  } = globalThis.ZeroLatencyBackgroundTaskStoreLifecycle;
  const {
    buildTaskStoreSnapshot,
  } = globalThis.ZeroLatencyBackgroundTaskStoreSnapshot;
  const MAX_TASKS = 80;

  const tasksById = new Map();
  let taskSequence = 0;

  function createTaskFromSubmission(submission) {
    const now = new Date().toISOString();
    const task = {
      taskId: createTaskId(),
      kind: normalizeTaskStoreText(submission.kind),
      queueId: normalizeTaskStoreText(submission.queueId) || "default",
      title: normalizeTaskStoreText(submission.title) || normalizeTaskStoreText(submission.kind),
      description: normalizeTaskStoreText(submission.description),
      dedupeKey: normalizeTaskStoreText(submission.dedupeKey),
      status: TASK_STATUSES.QUEUED,
      step: "queued",
      message: "Task queued.",
      progress: {
        percent: 0,
      },
      result: null,
      error: "",
      createdAt: now,
      queuedAt: now,
      startedAt: null,
      completedAt: null,
      updatedAt: now,
      logs: [],
      run: submission.run,
    };

    tasksById.set(task.taskId, task);
    appendTaskLog(task, "created", "info", "Task queued.");
    pruneTasks();
    scheduleTaskPersistence({ immediate: true });

    return task;
  }

  function getTask(taskId) {
    return cloneBackgroundTaskRecord(tasksById.get(String(taskId || "")) ?? null);
  }

  function getSnapshot() {
    return buildTaskStoreSnapshot(
      [...tasksById.values()],
      getRecentTaskLogsSnapshot()
    );
  }

  function updateTaskProgress(taskId, patch = {}) {
    const task = tasksById.get(String(taskId || ""));
    if (!task || isTerminalTaskStatus(task.status)) {
      return null;
    }

    if (patch.step !== undefined) {
      task.step = normalizeTaskStoreText(patch.step);
    }
    if (patch.message !== undefined) {
      task.message = normalizeTaskStoreText(patch.message);
    }
    if (patch.progress && typeof patch.progress === "object") {
      task.progress = {
        ...task.progress,
        ...cloneJsonValue(patch.progress),
      };
    }
    task.updatedAt = new Date().toISOString();

    if (patch.log) {
      appendTaskLog(task, "progress", "info", normalizeTaskStoreText(patch.log));
    }

    scheduleTaskPersistence();

    return cloneBackgroundTaskRecord(task);
  }

  function findActiveTaskByDedupeKey(kind, dedupeKey) {
    for (const task of tasksById.values()) {
      if (
        task.kind === kind &&
        task.dedupeKey === dedupeKey &&
        !isTerminalTaskStatus(task.status)
      ) {
        return task;
      }
    }

    return null;
  }

  function findNextQueuedTask(queueId) {
    return [...tasksById.values()]
      .filter((task) => task.queueId === queueId && task.status === TASK_STATUSES.QUEUED)
      .sort((left, right) =>
        String(left.queuedAt).localeCompare(String(right.queuedAt)) ||
        String(left.taskId).localeCompare(String(right.taskId))
      )[0] ?? null;
  }

  function pruneTasks() {
    const tasks = [...tasksById.values()];
    if (tasks.length <= MAX_TASKS) {
      return;
    }

    const terminalTasks = tasks
      .filter((task) => isTerminalTaskStatus(task.status))
      .sort((left, right) => String(left.updatedAt).localeCompare(String(right.updatedAt)));
    const removeCount = Math.min(terminalTasks.length, tasks.length - MAX_TASKS);

    for (const task of terminalTasks.slice(0, removeCount)) {
      tasksById.delete(task.taskId);
    }
  }

  function createTaskId() {
    taskSequence += 1;
    return `task_${Date.now().toString(36)}_${taskSequence.toString(36)}`;
  }

  function markTaskRunningAndPersist(task) {
    markTaskRunning(task);
    scheduleTaskPersistence({ immediate: true });
  }

  function markTaskCompletedAndPersist(task, result) {
    markTaskCompleted(task, result);
    scheduleTaskPersistence({ immediate: true });
  }

  function markTaskFailedAndPersist(task, error) {
    markTaskFailed(task, error);
    scheduleTaskPersistence({ immediate: true });
  }

  function restoreTaskRecords(rawRecords) {
    const restoredAt = new Date().toISOString();

    for (const rawRecord of Array.isArray(rawRecords) ? rawRecords : []) {
      const record = cloneBackgroundTaskRecord(rawRecord);

      if (!record?.taskId) {
        continue;
      }

      if (!isTerminalTaskStatus(record.status)) {
        record.status = TASK_STATUSES.FAILED;
        record.step = "interrupted";
        record.message = "Task was interrupted when the background service restarted.";
        record.error = record.message;
        record.completedAt = restoredAt;
        record.updatedAt = restoredAt;
        record.logs.push({
          event: "interrupted",
          level: "error",
          message: record.message,
          recordedAt: restoredAt,
        });
      }

      tasksById.set(record.taskId, record);
    }

    pruneTasks();
  }

  function getPersistableTaskRecords() {
    return [...tasksById.values()].map(cloneBackgroundTaskRecord);
  }

  function scheduleTaskPersistence(options) {
    globalThis.ZeroLatencyBackgroundTaskPersistence?.schedule?.(
      globalThis.ZeroLatencyBackgroundTaskStore,
      options
    );
  }

  globalThis.ZeroLatencyBackgroundTaskStore = {
    createTaskFromSubmission,
    getTask,
    getSnapshot,
    updateTaskProgress,
    findActiveTaskByDedupeKey,
    findNextQueuedTask,
    markTaskRunning: markTaskRunningAndPersist,
    markTaskCompleted: markTaskCompletedAndPersist,
    markTaskFailed: markTaskFailedAndPersist,
    appendTaskLog,
    pruneTasks,
    normalizeText: normalizeTaskStoreText,
    cloneBackgroundTaskRecord,
    restoreTaskRecords,
    getPersistableTaskRecords,
  };
})();
