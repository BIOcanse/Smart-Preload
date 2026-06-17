(() => {
  function createSnapshotLoader({
    statusTextElement,
    translate,
    queryActiveTab,
    requestSnapshot,
    renderSnapshot,
  }) {
    let reloadTimerId = null;
    let loadInFlight = false;
    let reloadQueued = false;

    function scheduleReload() {
      window.clearTimeout(reloadTimerId);
      reloadTimerId = window.setTimeout(() => {
        void load();
      }, 120);
    }

    async function load() {
      if (loadInFlight) {
        reloadQueued = true;
        return;
      }

      loadInFlight = true;
      let statusMessage = translate(
        "popupVisitGraphLoaded",
        [],
        "Visit graph loaded."
      );
      statusTextElement.textContent = translate(
        "popupLoadingVisitGraph",
        [],
        "Loading visit graph..."
      );

      try {
        do {
          reloadQueued = false;
          const activeTab = await queryActiveTab();
          const snapshot = await requestSnapshot(activeTab);

          if (snapshot?.ok === false) {
            throw new Error(snapshot.error || "Unknown snapshot error");
          }

          renderSnapshot(snapshot);
          statusMessage =
            snapshot?.serviceState?.paused === true
              ? translate(
                  "popupPausedMessage",
                  [],
                  "Plugin stopped: prediction and preloading are disabled."
                )
              : translate("popupVisitGraphLoaded", [], "Visit graph loaded.");
        } while (reloadQueued);
      } catch (error) {
        console.error(error);
        statusMessage = translate(
          "popupLoadVisitGraphFailed",
          [],
          "Failed to load visit graph."
        );
      } finally {
        loadInFlight = false;
        reloadQueued = false;
        statusTextElement.textContent = statusMessage;
      }
    }

    return {
      load,
      scheduleReload,
    };
  }

  globalThis.ZeroLatencyPopupSnapshotLoader = {
    create: createSnapshotLoader,
  };
})();
