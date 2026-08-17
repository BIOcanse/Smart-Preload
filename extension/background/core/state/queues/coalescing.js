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
        // 合并是本队列的定义行为：同 key 只跑**最新**那个任务，先前排队的那个函数
        // 直接被丢弃，且两个调用方都拿到同一个 promise（即先来的那个会收到后来者的
        // 结果）。对候选扫描这类"只关心当前页面状态"的场景这是正确语义。
        //
        // 但丢弃此前是完全静默的。这里记一条事件，让"我的那次扫描去哪了"这类问题
        // 有迹可循——尤其是将来有非累积型的调用方接进来时。
        globalThis.ZeroLatencyDebugEvents?.record?.("queue.coalesced", {
          queue: this.label,
          key: normalizedKey,
        });
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
