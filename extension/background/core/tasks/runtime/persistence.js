(function () {
  const TASK_SNAPSHOT_KEY = "backgroundTaskSnapshotV1";
  const PROGRESS_PERSIST_DELAY_MS = 1_000;
  let persistTimer = null;
  let persistQueue = Promise.resolve();
  let restored = false;

  async function restore(taskStore) {
    if (restored || !globalThis.chrome?.storage?.local) {
      return;
    }

    restored = true;
    const stored = await globalThis.chrome.storage.local.get({ [TASK_SNAPSHOT_KEY]: [] });
    taskStore.restoreTaskRecords?.(stored[TASK_SNAPSHOT_KEY]);
  }

  function schedule(taskStore, { immediate = false } = {}) {
    if (!globalThis.chrome?.storage?.local) {
      return;
    }

    if (persistTimer !== null) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }

    if (immediate) {
      void persist(taskStore);
      return;
    }

    persistTimer = setTimeout(() => {
      persistTimer = null;
      void persist(taskStore);
    }, PROGRESS_PERSIST_DELAY_MS);
  }

  function persist(taskStore) {
    const records = taskStore.getPersistableTaskRecords?.() || [];
    const next = persistQueue.then(() =>
      globalThis.chrome.storage.local.set({ [TASK_SNAPSHOT_KEY]: records })
    );
    persistQueue = next.catch((error) => {
      console.error("Background task snapshot persistence failed.", error);
    });
    return next;
  }

  globalThis.ZeroLatencyBackgroundTaskPersistence = {
    restore,
    schedule,
    persist,
  };
})();
