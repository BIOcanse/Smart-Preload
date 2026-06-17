(function () {
  const {
    TASK_STATUSES,
    isTerminalTaskStatus,
    cloneBackgroundTaskRecord,
  } = globalThis.ZeroLatencyBackgroundTaskModel;

  function buildTaskStoreSnapshot(tasks, recentLogs) {
    const clonedTasks = tasks.map(cloneBackgroundTaskRecord);
    const summary = clonedTasks.reduce(
      (accumulator, task) => {
        accumulator.total += 1;
        accumulator[task.status] = (accumulator[task.status] || 0) + 1;
        if (!isTerminalTaskStatus(task.status)) {
          accumulator.active += 1;
        }
        return accumulator;
      },
      {
        total: 0,
        active: 0,
      }
    );
    const queues = {};

    for (const task of clonedTasks) {
      const queue = queues[task.queueId] || {
        queueId: task.queueId,
        queued: 0,
        running: 0,
      };
      if (task.status === TASK_STATUSES.QUEUED) {
        queue.queued += 1;
      }
      if (task.status === TASK_STATUSES.RUNNING) {
        queue.running += 1;
      }
      queues[task.queueId] = queue;
    }

    return {
      ok: true,
      summary,
      queues: Object.values(queues),
      tasks: clonedTasks,
      recentLogs,
      updatedAt: new Date().toISOString(),
    };
  }

  globalThis.ZeroLatencyBackgroundTaskStoreSnapshot = {
    buildTaskStoreSnapshot,
  };
})();
