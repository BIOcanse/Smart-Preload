(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});

  function bindNavigationLifecycleEvents() {
    document.addEventListener("DOMContentLoaded", () => {
      namespace.scheduleCandidateScan({
        delayMs: namespace.constants.EARLY_LINK_RESCAN_DELAY_MS,
        force: true,
      });
      namespace.schedulePageDigestReport();
    });

    window.addEventListener("load", () => {
      namespace.scheduleCandidateScan({
        delayMs: namespace.constants.RESCAN_DELAY_MS,
        force: true,
      });
      namespace.schedulePageDigestReport();
    });

    document.addEventListener("prerenderingchange", () => {
      if (namespace.isPassivePrerenderContext()) {
        void namespace.reportAttentionActivity({ force: true });
        return;
      }

      void namespace.reportAttentionActivity({ force: true });
      namespace.scheduleCandidateScan();
      namespace.schedulePageDigestReport();
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
        window.clearTimeout(namespace.state.candidateScanTimerId);
        namespace.state.candidateScanTimerId = null;
        namespace.state.candidateScanDueAt = 0;
        namespace.state.candidateScanForce = false;
        window.clearTimeout(namespace.state.pageDigestTimerId);
      }
    });

    document.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (namespace.state.deferredScanWhileEditing && !namespace.hasActiveEditableFocus()) {
          namespace.state.deferredScanWhileEditing = false;
          namespace.scheduleCandidateScan();
        }
        if (
          namespace.state.deferredPageDigestWhileEditing &&
          !namespace.hasActiveEditableFocus()
        ) {
          namespace.state.deferredPageDigestWhileEditing = false;
          namespace.schedulePageDigestReport();
        }
      }, 0);
    });
  }

  Object.assign(namespace, {
    bindNavigationLifecycleEvents,
  });
})();
