(function () {
  class ZeroLatencyPriorityTaskQueue {
    constructor({ label = "priority", onError = null, highBurstLimit = 4 } = {}) {
      this.label = label;
      this.onError = typeof onError === "function" ? onError : null;
      this.highBurstLimit = Math.max(1, Number(highBurstLimit) || 4);
      this.highPriorityItems = [];
      this.normalPriorityItems = [];
      this.highPriorityRunCount = 0;
      this.draining = false;
    }

    enqueue(task, { priority = "normal" } = {}) {
      if (typeof task !== "function") {
        return Promise.reject(new TypeError(`${this.label} queue task must be a function.`));
      }

      let resolveResult;
      let rejectResult;
      const promise = new Promise((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
      });
      const item = {
        task,
        resolve: resolveResult,
        reject: rejectResult,
      };

      if (priority === "high") {
        this.highPriorityItems.push(item);
      } else {
        this.normalPriorityItems.push(item);
      }

      void this.drain();
      return promise;
    }

    takeNextItem() {
      const canRunHigh =
        this.highPriorityItems.length > 0 &&
        (this.normalPriorityItems.length === 0 ||
          this.highPriorityRunCount < this.highBurstLimit);

      if (canRunHigh) {
        this.highPriorityRunCount += 1;
        return this.highPriorityItems.shift();
      }

      this.highPriorityRunCount = 0;
      return this.normalPriorityItems.shift() ?? this.highPriorityItems.shift() ?? null;
    }

    async drain() {
      if (this.draining) {
        return;
      }

      this.draining = true;

      try {
        while (this.highPriorityItems.length > 0 || this.normalPriorityItems.length > 0) {
          const item = this.takeNextItem();

          if (!item) {
            break;
          }

          try {
            item.resolve(await item.task());
          } catch (error) {
            item.reject(error);
            this.reportError(error);
          }
        }
      } finally {
        this.draining = false;

        if (this.highPriorityItems.length > 0 || this.normalPriorityItems.length > 0) {
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

  globalThis.ZeroLatencyPriorityTaskQueue = ZeroLatencyPriorityTaskQueue;
})();
