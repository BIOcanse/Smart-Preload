async function promotePreloadedTabToSourceWindow({
  sourceTab,
  preloadedTab,
  targetUrl,
  openInNewTab,
}) {
  globalThis.clearKnownPreloadTab?.(preloadedTab.id);
  const movedTab = await chrome.tabs.move(preloadedTab.id, {
    windowId: sourceTab.windowId,
    index: (sourceTab.index ?? 0) + 1,
  });
  const activatedTab = Array.isArray(movedTab) ? movedTab[0] : movedTab;

  await ensureActivatedTabHasNavigableUrl(activatedTab, targetUrl);
  await chrome.tabs.update(activatedTab.id, { active: true });

  if (!openInNewTab) {
    await chrome.tabs.remove(sourceTab.id);
  }

  await requestActivatedTabCandidateRefresh(activatedTab);

  return activatedTab;
}

async function ensureActivatedTabHasNavigableUrl(activatedTab, targetUrl) {
  if (!activatedTab?.id || !targetUrl) {
    return;
  }

  const currentUrl = String(activatedTab.url || "");
  if (currentUrl && currentUrl !== "about:blank") {
    return;
  }

  await chrome.tabs.update(activatedTab.id, { url: targetUrl });
}

async function requestActivatedTabCandidateRefresh(activatedTab) {
  try {
    if (globalThis.ZeroLatencySupport?.hasChromeNamespaceMethod?.("tabs", "sendMessage") === true) {
      await chrome.tabs.sendMessage(activatedTab.id, {
        type: "preload:collect-candidates",
      });
    }
  } catch (_error) {
    // The destination tab may not have a content script yet on some pages.
  }
}
