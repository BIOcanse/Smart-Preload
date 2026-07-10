(function () {
  class ZeroLatencyCoalescingTaskQueue {
    constructor({ label = "coalescing", onError = null } = {}) {
      this.label = label;
      this.onError = typeof onError === "function" ? onError : null;
      this.pendingItems = [];
      this.pendingByKey = new Map();
      this.draining = false;
    }

    enqueue(key, task) {
      if (typeof task !== "function") {
        return Promise.reject(new TypeError(`${this.label} queue task must be a function.`));
      }

      const normalizedKey = this.normalizeKey(key);
      const existing = this.pendingByKey.get(normalizedKey);

      if (existing) {
        existing.task = task;
        return existing.promise;
      }

      let resolveResult;
      let rejectResult;
      const promise = new Promise((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
      });
      const item = {
        key: normalizedKey,
        task,
        promise,
        resolve: resolveResult,
        reject: rejectResult,
      };

      this.pendingItems.push(item);
      this.pendingByKey.set(normalizedKey, item);
      void this.drain();
      return promise;
    }

    normalizeKey(key) {
      const normalized = String(key ?? "default").trim();
      return normalized || "default";
    }

    async drain() {
      if (this.draining) {
        return;
      }

      this.draining = true;

      try {
        while (this.pendingItems.length > 0) {
          const item = this.pendingItems.shift();
          this.pendingByKey.delete(item.key);

          try {
            item.resolve(await item.task());
          } catch (error) {
            item.reject(error);
            this.reportError(error);
          }
        }
      } finally {
        this.draining = false;

        if (this.pendingItems.length > 0) {
          void this.drain();
        }
      }
    }

    reportError(error) {
      if (this.onError) {
        this.onError(error, this.label);
        return;
      }

      console.error(`Smart Preload ${this.label} task failed.`, error);
    }
  }

  globalThis.ZeroLatencyCoalescingTaskQueue = ZeroLatencyCoalescingTaskQueue;
})();
