(function () {
  function handleBackgroundTaskSnapshot() {
    return globalThis.ZeroLatencyBackgroundTasks?.getSnapshot?.() ?? {
      ok: false,
      error: "background task runtime unavailable",
    };
  }

  function handleBackgroundTaskGet(message) {
    const task = globalThis.ZeroLatencyBackgroundTasks?.getTask?.(message?.taskId);

    if (!task) {
      return {
        ok: false,
        error: "background task not found",
      };
    }

    return {
      ok: true,
      task,
    };
  }

  globalThis.ZeroLatencyCoreTaskMessages = {
    handleBackgroundTaskSnapshot,
    handleBackgroundTaskGet,
  };
})();
