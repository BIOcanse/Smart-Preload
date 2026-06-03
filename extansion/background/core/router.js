(function () {
  class ZeroLatencyMainRouter {
    async bootstrap() {
      await globalThis.ZeroLatencyRouterRuntime.dispatchRuntimeEvent("bootstrap");
    }

    async handleInstalled() {
      await globalThis.ZeroLatencyRouterRuntime.dispatchRuntimeEvent("installed");
    }

    async handleStartup() {
      await globalThis.ZeroLatencyRouterRuntime.dispatchRuntimeEvent("startup");
    }

    async handleStorageChanged(changes, areaName) {
      await globalThis.ZeroLatencyRouterRuntime.dispatchRuntimeEvent("storage-changed", {
        changes,
        areaName,
      });
    }

    async handleCommitted(details) {
      await globalThis.ZeroLatencyRouterNavigation.dispatchNavigationEvent("committed", details);
    }

    async handleHistoryStateUpdated(details) {
      await globalThis.ZeroLatencyRouterNavigation.dispatchNavigationEvent(
        "history-state-updated",
        details
      );
    }

    async handleCreatedNavigationTarget(details) {
      await globalThis.ZeroLatencyRouterNavigation.dispatchNavigationEvent(
        "created-navigation-target",
        details
      );
    }

    async handleTabReplaced(details) {
      await globalThis.ZeroLatencyRouterNavigation.dispatchNavigationEvent(
        "tab-replaced",
        details
      );
    }

    async handleTabCreated(tab) {
      await globalThis.ZeroLatencyRouterNavigation.dispatchNavigationEvent("tab-created", tab);
    }

    async handleTabRemoved(tabId) {
      await globalThis.ZeroLatencyRouterNavigation.dispatchNavigationEvent("tab-removed", { tabId });
    }

    async handleTabUpdated(tabId, changeInfo, tab) {
      await globalThis.ZeroLatencyRouterNavigation.dispatchNavigationEvent("tab-updated", {
        tabId,
        changeInfo,
        tab,
      });
    }

    async handleTabActivated(activeInfo) {
      await globalThis.ZeroLatencyRouterNavigation.dispatchNavigationEvent(
        "tab-activated",
        activeInfo
      );
    }

    async handleWindowRemoved(windowId) {
      await globalThis.ZeroLatencyRouterNavigation.dispatchNavigationEvent("window-removed", {
        windowId,
      });
    }

    async handleWindowFocused(windowId) {
      await globalThis.ZeroLatencyRouterNavigation.dispatchNavigationEvent("window-focused", {
        windowId,
      });
    }

    async handleWindowBoundsChanged(window) {
      await globalThis.ZeroLatencyRouterNavigation.dispatchNavigationEvent(
        "window-bounds-changed",
        { window }
      );
    }

    async handleAlarm(alarm) {
      await globalThis.ZeroLatencyRouterNavigation.dispatchNavigationEvent("alarm", alarm);
    }

    createMessageTask(message, sender) {
      return globalThis.ZeroLatencyRouterMessages.createMessageTask(message, sender);
    }
  }

  globalThis.ZeroLatencyMainRouter = ZeroLatencyMainRouter;
})();
