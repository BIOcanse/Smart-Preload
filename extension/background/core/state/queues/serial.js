(function () {
  class ZeroLatencySerialTaskQueue {
    constructor({ label = "task", onError = null } = {}) {
      this.label = label;
      this.onError = typeof onError === "function" ? onError : null;
      this.tail = Promise.resolve();
    }

    enqueue(task) {
      if (typeof task !== "function") {
        return Promise.reject(new TypeError(`${this.label} queue task must be a function.`));
      }

      const result = this.tail.then(task);
      this.tail = result.catch((error) => {
        this.reportError(error);
      });
      return result;
    }

    reportError(error) {
      if (this.onError) {
        this.onError(error, this.label);
        return;
      }

      console.error(`Smart Preload ${this.label} task failed.`, error);
    }
  }

  globalThis.ZeroLatencySerialTaskQueue = ZeroLatencySerialTaskQueue;
})();
