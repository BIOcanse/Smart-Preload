(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});

  function bindNavigationContentEvents() {
    namespace.bindNavigationInputEvents();
    namespace.bindNavigationLinkEvents();
    namespace.bindNavigationLifecycleEvents();
    namespace.bindRuntimeMessages();
    namespace.startAttentionActivityReporter();
    namespace.startMutationObserverWhenReady(namespace.createMutationObserver());
  }

  Object.assign(namespace, {
    bindNavigationContentEvents,
  });
})();
