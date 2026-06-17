async function primePreloadEntry(windowId, entry) {
  if (
    globalThis.ZeroLatencySupport?.supportsHiddenTabPreloadRuntime?.() !== true ||
    !Number.isFinite(windowId)
  ) {
    entry.status = "unsupported";
    entry.updatedAt = new Date().toISOString();
    return;
  }

  const blankTab = await chrome.tabs.create({
    windowId,
    url: "about:blank",
    active: false,
  });

  globalThis.markKnownPreloadWindow?.(windowId);
  globalThis.markKnownPreloadTab?.(blankTab.id, { windowId });
  entry.tabId = blankTab.id;
  entry.loadedUrl = null;
  entry.status = "priming";
  entry.updatedAt = new Date().toISOString();

  try {
    await chrome.tabs.update(blankTab.id, { autoDiscardable: false });
  } catch (_error) {
    // Older Chrome builds may reject autoDiscardable updates.
  }

  await chrome.tabs.update(blankTab.id, {
    url: entry.requestedUrl,
    active: false,
  });

  entry.status = "loading";
  entry.updatedAt = new Date().toISOString();
}
