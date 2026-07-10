(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});

  function bindNavigationLifecycleEvents() {
    document.addEventListener("DOMContentLoaded", () => {
      namespace.scheduleCandidateScan({
        delayMs: namespace.constants.EARLY_LINK_RESCAN_DELAY_MS,
        force: true,
        includePageDigest: true,
      });
    });

    window.addEventListener("load", () => {
      namespace.scheduleCandidateScan({
        delayMs: namespace.constants.RESCAN_DELAY_MS,
        force: true,
        includePageDigest: true,
      });
    });

    document.addEventListener("prerenderingchange", () => {
      if (namespace.isPassivePrerenderContext()) {
        void namespace.reportAttentionActivity({ force: true });
        return;
      }

      void namespace.reportAttentionActivity({ force: true });
      namespace.scheduleCandidateScan({
        includePageDigest: true,
      });
    });

    document.addEventListener("visibilitychange", () => {
      void namespace.reportAttentionActivity({ force: true });
    });

    bindNavigationMediaActivityEvents();
    bindNavigationEditableFocusEvents();
  }

  function bindNavigationMediaActivityEvents() {
    for (const eventName of ["play", "playing", "pause", "ended"]) {
      document.addEventListener(
        eventName,
        () => {
          void namespace.reportAttentionActivity({ force: true });
        },
        true
      );
    }
  }

  function bindNavigationEditableFocusEvents() {
    document.addEventListener("focusin", () => {
      if (namespace.hasActiveEditableFocus()) {
        namespace.state.deferredScanWhileEditing = true;
        namespace.state.deferredPageDigestWhileEditing =
          namespace.state.deferredPageDigestWhileEditing ||
          namespace.state.candidateScanIncludePageDigest;
        namespace.cancelScheduledNavigationScan?.({
          preserveRequestedWork: true,
        });
      }
    });

    document.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (namespace.hasActiveEditableFocus()) {
          return;
        }

        const shouldResumeScan = namespace.state.deferredScanWhileEditing;
        const includePageDigest = namespace.state.deferredPageDigestWhileEditing;
        namespace.state.deferredScanWhileEditing = false;
        namespace.state.deferredPageDigestWhileEditing = false;

        if (shouldResumeScan || includePageDigest) {
          namespace.scheduleCandidateScan({
            includePageDigest,
          });
        }
      }, 0);
    });
  }

  Object.assign(namespace, {
    bindNavigationLifecycleEvents,
  });
})();
