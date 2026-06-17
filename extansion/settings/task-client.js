(() => {
  const DEFAULT_POLL_INTERVAL_MS = 400;
  const DEFAULT_TIMEOUT_MS = 30_000;
  const TERMINAL_STATUSES = new Set(["completed", "failed", "canceled"]);

  async function waitForTask(taskId, options = {}) {
    const normalizedTaskId = String(taskId || "").trim();
    if (!normalizedTaskId) {
      throw new Error("background task id is required");
    }

    const pollIntervalMs = Math.max(
      100,
      Number(options.pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS
    );
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
    const startedAt = Date.now();
    let lastTask = null;

    while (Date.now() - startedAt <= timeoutMs) {
      const response = await chrome.runtime.sendMessage({
        type: "background-task:get",
        taskId: normalizedTaskId,
      });

      if (response?.ok !== true || !response.task) {
        throw new Error(response?.error || "background task query failed");
      }

      lastTask = response.task;
      options.onTask?.(lastTask);

      if (TERMINAL_STATUSES.has(String(lastTask.status || "").toLowerCase())) {
        if (lastTask.status === "completed") {
          return lastTask;
        }

        throw new Error(lastTask.error || lastTask.message || "background task failed");
      }

      await sleep(pollIntervalMs);
    }

    throw new Error(lastTask?.message || "background task timed out");
  }

  async function getSnapshot() {
    const response = await chrome.runtime.sendMessage({
      type: "background-task:snapshot",
    });

    if (response?.ok !== true) {
      throw new Error(response?.error || "background task snapshot failed");
    }

    return response;
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  globalThis.ZeroLatencySettingsTaskClient = {
    waitForTask,
    getSnapshot,
  };
})();
