(function () {
  const taskStore = globalThis.ZeroLatencyBackgroundTaskStore;
  const queueLoops = new Map();

  function scheduleQueue(queueId) {
    const normalizedQueueId = taskStore.normalizeText(queueId) || "default";
    const existingLoop = queueLoops.get(normalizedQueueId);

    if (existingLoop && typeof existingLoop.finally === "function") {
      return;
    }

    const loop = Promise.resolve()
      .then(() => processQueue(normalizedQueueId))
      .catch((error) => {
        console.error("Background task queue failed.", normalizedQueueId, error);
      })
      .finally(() => {
        queueLoops.delete(normalizedQueueId);
        if (taskStore.findNextQueuedTask(normalizedQueueId)) {
          scheduleQueue(normalizedQueueId);
        }
      });
    queueLoops.set(normalizedQueueId, loop);
  }

  async function processQueue(queueId) {
    while (true) {
      const task = taskStore.findNextQueuedTask(queueId);

      if (!task) {
        return;
      }

      await runTask(task);
    }
  }

  async function runTask(task) {
    taskStore.markTaskRunning(task);

    try {
      const result = await task.run(createTaskContext(task));
      taskStore.markTaskCompleted(task, result);
    } catch (error) {
      taskStore.markTaskFailed(task, error);
    } finally {
      delete task.run;
      taskStore.pruneTasks();
    }
  }

  function createTaskContext(task) {
    return {
      taskId: task.taskId,
      setProgress(patch) {
        return taskStore.updateTaskProgress(task.taskId, patch);
      },
      appendLog(event, level, message) {
        taskStore.appendTaskLog(task, event, level, message);
      },
    };
  }

  globalThis.ZeroLatencyBackgroundTaskQueue = {
    scheduleQueue,
  };
})();
