(function () {
  function createBackgroundTaskQueues() {
    const onError = (error, label) => {
      console.error(`Smart Preload ${label} task failed.`, error);
    };

    return {
      mutation: new globalThis.ZeroLatencyPriorityTaskQueue({
        label: "mutation",
        onError,
      }),
      sideEffect: new globalThis.ZeroLatencySerialTaskQueue({
        label: "side effect",
        onError,
      }),
      lifecycle: new globalThis.ZeroLatencyCoalescingTaskQueue({
        label: "lifecycle",
        onError,
      }),
      candidate: new globalThis.ZeroLatencyCoalescingTaskQueue({
        label: "candidate",
        onError,
      }),
      attention: new globalThis.ZeroLatencyCoalescingTaskQueue({
        label: "attention",
        onError,
      }),
      ai: new globalThis.ZeroLatencyCoalescingTaskQueue({
        label: "AI",
        onError,
      }),
    };
  }

  globalThis.ZeroLatencyBackgroundTaskQueues = {
    create: createBackgroundTaskQueues,
  };
})();
