async function handleCreatedTabContextMenuFallback(tab) {
  if (tab?.openerTabId == null) {
    return;
  }

  const fallbackActivation =
    await globalThis.ZeroLatencyPreloadRuntimeManager.activateUpdatedTabNavigationTarget?.({
      tabId: tab.id,
      changeInfo: {
        url: tab.pendingUrl || tab.url || "",
      },
      tab,
    });
  const fallbackPayload = {
    tabId: tab.id,
    openerTabId: tab.openerTabId ?? null,
    url: tab.pendingUrl || tab.url || "",
    handled: fallbackActivation?.handled === true,
    reason: fallbackActivation?.reason ?? null,
    debug: fallbackActivation?.debug ?? null,
    activatedTabId: fallbackActivation?.tabId ?? null,
  };
  recordContextMenuFallbackEvent(
    "tracking.tab-created.contextmenu-preload-fallback",
    fallbackPayload
  );

  if (fallbackActivation?.handled === true) {
    recordContextMenuFallbackEvent(
      "tracking.tab-created.contextmenu-preload-activated",
      {
        tabId: tab.id,
        openerTabId: tab.openerTabId ?? null,
        url: tab.pendingUrl || tab.url || "",
        activatedTabId: fallbackActivation.tabId ?? null,
      }
    );
  }
}

async function handleUpdatedTabContextMenuFallback(update) {
  const fallbackUrl =
    update?.changeInfo?.url ?? update?.tab?.pendingUrl ?? update?.tab?.url ?? "";

  if (update?.tab?.openerTabId == null) {
    return false;
  }

  const fallbackActivation =
    await globalThis.ZeroLatencyPreloadRuntimeManager.activateUpdatedTabNavigationTarget?.(
      update
    );
  const fallbackPayload = {
    tabId: update.tabId,
    openerTabId: update.tab?.openerTabId ?? null,
    url: fallbackUrl,
    handled: fallbackActivation?.handled === true,
    reason: fallbackActivation?.reason ?? null,
    debug: fallbackActivation?.debug ?? null,
    activatedTabId: fallbackActivation?.tabId ?? null,
  };
  recordContextMenuFallbackEvent(
    "tracking.tab-updated.contextmenu-preload-fallback",
    fallbackPayload
  );

  if (fallbackActivation?.handled !== true) {
    return false;
  }

  recordContextMenuFallbackEvent(
    "tracking.tab-updated.contextmenu-preload-activated",
    {
      tabId: update.tabId,
      openerTabId: update.tab?.openerTabId ?? null,
      url: fallbackUrl,
      activatedTabId: fallbackActivation.tabId ?? null,
    }
  );
  return true;
}

function recordContextMenuFallbackEvent(eventName, payload) {
  globalThis.ZeroLatencyDiagnostics?.record?.(eventName, payload);
  globalThis.ZeroLatencyDebugEvents?.record?.(eventName, payload);
}
