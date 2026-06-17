(function () {
  const APP_UPDATE_STATUS_PATH = "/api/v1/app/update/status";
  const APP_UPDATE_REQUEST_PATH = "/api/v1/app/update";

  async function handleNativeAppUpdateStatus() {
    const response = await fetchNativeApp(APP_UPDATE_STATUS_PATH, {
      method: "GET",
      timeoutMs: 2500,
    });

    return {
      ok: response?.ok === true,
      currentVersion: String(response?.currentVersion || ""),
      updateSupported: response?.updateSupported === true,
      updaterStatus: response?.updaterStatus || "",
    };
  }

  async function handleNativeAppUpdateToVersion(message) {
    const targetVersion = String(message?.targetVersion || "").trim();
    const assetName = String(message?.assetName || "").trim();
    const assetUrl = String(message?.assetUrl || "").trim();
    const releaseUrl = String(message?.releaseUrl || "").trim();

    if (!targetVersion || !assetName || !assetUrl) {
      throw new Error("Native app update request is incomplete.");
    }

    const task = globalThis.ZeroLatencyBackgroundTasks.submitTask({
      kind: "native-app.update",
      queueId: "native-app",
      title: `Native app update ${targetVersion}`,
      description: "Update the Windows native app through the local app updater.",
      dedupeKey: `native-app.update:${targetVersion}`,
      run: async (context) => {
        context.setProgress({
          step: "requesting-native-app",
          message: `Starting native app update to v${targetVersion}.`,
          progress: {
            percent: 20,
          },
        });

        const response = await fetchNativeApp(APP_UPDATE_REQUEST_PATH, {
          method: "POST",
          timeoutMs: 5000,
          body: {
            targetVersion,
            assetName,
            assetUrl,
            releaseUrl,
          },
        });

        if (response?.ok !== true) {
          throw new Error(response?.error || response?.message || "native app update request failed");
        }

        context.setProgress({
          step: "accepted",
          message: `Native app update to v${targetVersion} accepted.`,
          progress: {
            percent: 100,
          },
        });

        return response;
      },
    });

    return {
      ok: true,
      taskId: task.taskId,
      task,
    };
  }

  globalThis.ZeroLatencyCoreNativeAppUpdateMessages = {
    handleNativeAppUpdateStatus,
    handleNativeAppUpdateToVersion,
  };
})();
