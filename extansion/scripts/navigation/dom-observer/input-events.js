(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});

  function bindNavigationInputEvents() {
    document.addEventListener(
      "mousedown",
      (event) => {
        namespace.recordUserInputForAttention();
        void namespace.primeSourcePageForNavigation(event);
      },
      true
    );

    for (const eventName of ["mousemove", "wheel", "touchstart"]) {
      document.addEventListener(
        eventName,
        () => {
          namespace.recordUserInputForAttention();
        },
        {
          capture: true,
          passive: true,
        }
      );
    }

    document.addEventListener(
      "keydown",
      () => {
        namespace.recordUserInputForAttention();
      },
      true
    );
  }

  Object.assign(namespace, {
    bindNavigationInputEvents,
  });
})();
