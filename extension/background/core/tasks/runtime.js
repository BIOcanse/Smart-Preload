(function () {
  const taskStore = globalThis.ZeroLatencyBackgroundTaskStore;
  const taskQueue = globalThis.ZeroLatencyBackgroundTaskQueue;

  function submitTask(submission) {
    validateTaskSubmission(submission);

    const kind = taskStore.normalizeText(submission.kind);
    const dedupeKey = taskStore.normalizeText(submission.dedupeKey);
    if (dedupeKey) {
      const existing = taskStore.findActiveTaskByDedupeKey(kind, dedupeKey);
      if (existing) {
        taskStore.appendTaskLog(
          existing,
          "deduped",
          "info",
          "Existing active task reused."
        );
        return taskStore.cloneBackgroundTaskRecord(existing);
      }
    }

    const task = taskStore.createTaskFromSubmission({
      ...submission,
      kind,
      dedupeKey,
    });
    taskQueue.scheduleQueue(task.queueId);

    return taskStore.cloneBackgroundTaskRecord(task);
  }

  function validateTaskSubmission(submission) {
    if (!submission || typeof submission !== "object") {
      throw new Error("Task submission is required.");
    }
    if (!taskStore.normalizeText(submission.kind)) {
      throw new Error("Task kind is required.");
    }
    if (typeof submission.run !== "function") {
      throw new Error("Task run handler is required.");
    }
  }

  globalThis.ZeroLatencyBackgroundTasks = {
    submitTask,
    getTask: taskStore.getTask,
    getSnapshot: taskStore.getSnapshot,
    updateTaskProgress: taskStore.updateTaskProgress,
  };
})();
