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

  globalThis.ZeroLatencyBackgroundTaskStore = {
    createTaskFromSubmission,
    getTask,
    getSnapshot,
    updateTaskProgress,
    findActiveTaskByDedupeKey,
    findNextQueuedTask,
    markTaskRunning,
    markTaskCompleted,
    markTaskFailed,
    appendTaskLog,
    pruneTasks,
    normalizeText: normalizeTaskStoreText,
    cloneBackgroundTaskRecord,
  };
})();
