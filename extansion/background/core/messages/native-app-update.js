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
    const response = await fetchNativeApp(APP_UPDATE_REQUEST_PATH, {
      method: "POST",
      timeoutMs: 5000,
      body: {
        targetVersion: String(message?.targetVersion || ""),
        assetName: String(message?.assetName || ""),
        assetUrl: String(message?.assetUrl || ""),
        releaseUrl: String(message?.releaseUrl || ""),
      },
    });

    return response;
  }

  globalThis.ZeroLatencyCoreNativeAppUpdateMessages = {
    handleNativeAppUpdateStatus,
    handleNativeAppUpdateToVersion,
  };
})();
