(() => {
  function createServiceStateController({
    button,
    setBusy,
    getStatusText,
    translate,
    requestSetPaused,
    loadSnapshot,
  }) {
    let servicePaused = false;

    function render(serviceState) {
      servicePaused = serviceState?.paused === true;
      button.textContent = servicePaused
        ? translate("popupStart", [], "Start")
        : translate("popupStop", [], "Stop");
      button.title = servicePaused
        ? translate("popupRestoreServiceTitle", [], "Resume prediction and preloading")
        : translate(
            "popupStopServiceTitle",
            [],
            "Stop prediction and preloading, and close the background preload window"
          );
      button.classList.toggle("danger", !servicePaused);
      button.classList.toggle("success", servicePaused);
    }

    async function toggle() {
      const nextPaused = !servicePaused;
      let statusMessage = "";

      setBusy(
        true,
        nextPaused
          ? translate("popupStoppingService", [], "Stopping prediction and preloading...")
          : translate("popupStartingService", [], "Starting prediction and preloading...")
      );

      try {
        const response = await requestSetPaused(nextPaused);

        if (response?.ok === false) {
          throw new Error(
            response.error ||
              translate("popupUpdateStateFailed", [], "Failed to update plugin state.")
          );
        }

        render(response?.serviceState);
        await loadSnapshot();
        statusMessage = getStatusText();
      } catch (error) {
        console.error(error);
        statusMessage = translate(
          "popupUpdateStateFailed",
          [],
          "Failed to update plugin state."
        );
      } finally {
        setBusy(false, statusMessage || getStatusText());
      }
    }

    return {
      render,
      toggle,
      isPaused: () => servicePaused,
    };
  }

  globalThis.ZeroLatencyPopupServiceState = {
    create: createServiceStateController,
  };
})();
