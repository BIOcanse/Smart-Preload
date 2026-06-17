async function validatePreloadedActivationIncognitoContext({
  sourceTab,
  preloadedTab,
  targetWindowId,
  targetUrl,
}) {
  const destinationWindowId = targetWindowId ?? sourceTab.windowId;
  const destinationWindow = await getWindowMaybe(destinationWindowId);
  const sourceDestinationMatch =
    globalThis.ZeroLatencyPreloadIncognitoPolicy?.resolveSourceTargetIncognitoMatch?.(
      sourceTab,
      null,
      destinationWindow
    );
  const sourcePreloadMatch =
    globalThis.ZeroLatencyPreloadIncognitoPolicy?.resolveSourceTargetIncognitoMatch?.(
      sourceTab,
      preloadedTab,
      null
    );

  if (sourceDestinationMatch?.matches !== false && sourcePreloadMatch?.matches !== false) {
    return { ok: true, destinationWindowId };
  }

  globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.incognito-mismatch", {
    sourceTabId: sourceTab.id,
    sourceWindowId: sourceTab.windowId,
    targetUrl,
    preloadedTabId: preloadedTab.id,
    targetWindowId: destinationWindowId,
    sourceIncognito: sourcePreloadMatch?.sourceIncognito ?? sourceTab?.incognito === true,
    preloadedIncognito: preloadedTab?.incognito === true,
    destinationIncognito: destinationWindow?.incognito === true,
  });
  return {
    ok: false,
    response: { handled: false, reason: "incognito-context-mismatch" },
    destinationWindowId,
  };
}
