async function releaseContextMenuPreloadForIncognitoIfNeeded({
  sourceTab,
  targetTab,
  targetWindow,
  targetTabId,
  targetUrl,
  runtimeSettings,
}) {
  const incognitoMatch =
    globalThis.ZeroLatencyPreloadIncognitoPolicy?.resolveSourceTargetIncognitoMatch?.(
      sourceTab,
      targetTab,
      targetWindow
    ) ?? {
      sourceIncognito: sourceTab?.incognito === true,
      targetIncognito: targetTab?.incognito === true || targetWindow?.incognito === true,
      matches:
        (sourceTab?.incognito === true) ===
        (targetTab?.incognito === true || targetWindow?.incognito === true),
    };
  const sourceExcluded =
    incognitoMatch.sourceIncognito === true &&
    globalThis.ZeroLatencyPreloadIncognitoPolicy?.isIncognitoPreloadExclusionEnabled?.(
      runtimeSettings
    ) === true;
  const shouldReleaseForIncognito =
    incognitoMatch.matches !== true || sourceExcluded;

  if (!shouldReleaseForIncognito) {
    return null;
  }

  const reason = sourceExcluded
    ? "incognito-excluded"
    : incognitoMatch.targetIncognito === true
      ? "incognito-target"
      : "incognito-context-mismatch";
  const discarded =
    await globalThis.ZeroLatencyPreloadInteraction.discardContextMenuInteractionHiddenTabPreload(
      {
        sourceTab,
        targetUrl,
        reason,
      }
    );

  globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.incognito-release", {
    sourceTabId: sourceTab.id,
    sourceWindowId: sourceTab.windowId,
    targetTabId,
    targetWindowId: targetTab?.windowId ?? null,
    targetUrl,
    sourceIncognito: incognitoMatch.sourceIncognito,
    targetIncognito: incognitoMatch.targetIncognito,
    discarded,
  });

  return {
    handled: false,
    reason: `${reason}-released`,
    discarded,
  };
}

globalThis.ZeroLatencyContextMenuPreloadIncognito = {
  releaseContextMenuPreloadForIncognitoIfNeeded,
};
