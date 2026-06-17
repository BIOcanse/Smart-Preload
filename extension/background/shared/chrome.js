async function getTabMaybe(tabId) {
  if (globalThis.ZeroLatencySupport?.hasChromeNamespaceMethod?.("tabs", "get") !== true) {
    return null;
  }

  try {
    return await chrome.tabs.get(tabId);
  } catch (_error) {
    return null;
  }
}

async function closeTabIfExists(tabId) {
  if (globalThis.ZeroLatencySupport?.hasChromeNamespaceMethod?.("tabs", "remove") !== true) {
    return;
  }

  markExpectedPreloadRemoval(tabId);

  try {
    await chrome.tabs.remove(tabId);
  } catch (_error) {
    clearExpectedPreloadRemoval(tabId);
    // The tab may already be gone.
  }
}

async function getWindowMaybe(windowId) {
  if (globalThis.ZeroLatencySupport?.hasChromeNamespaceMethod?.("windows", "get") !== true) {
    return null;
  }

  try {
    return await chrome.windows.get(windowId);
  } catch (_error) {
    return null;
  }
}
