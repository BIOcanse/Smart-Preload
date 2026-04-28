(function () {
  async function handleOpenSettings() {
    const settingsUrl = chrome.runtime.getURL("settings/index.html");

    try {
      const tab = await chrome.tabs.create({
        url: settingsUrl,
        active: true,
      });

      return {
        ok: true,
        openedWith: "tab",
        tabId: tab?.id ?? null,
      };
    } catch (tabError) {
      console.error("Failed to open settings in a tab.", tabError);
    }

    try {
      const window = await chrome.windows.create({
        url: settingsUrl,
        focused: true,
        type: "normal",
      });

      return {
        ok: true,
        openedWith: "window",
        windowId: window?.id ?? null,
      };
    } catch (windowError) {
      console.error("Failed to open settings in a window.", windowError);
    }

    await chrome.runtime.openOptionsPage();
    return {
      ok: true,
      openedWith: "options-page",
    };
  }

  globalThis.ZeroLatencyCoreSettingsMessages = {
    handleOpenSettings,
  };
})();
