async function resolveInteractionPreloadContext(message, sender, options = {}) {
  const sourceContext = await resolveInteractionPreloadSourceContext(message, sender);

  if (!sourceContext.ok) {
    return sourceContext;
  }

  const targetContext = resolveInteractionPreloadTargetContext({
    message,
    sourceTab: sourceContext.sourceTab,
    sourcePageUrl: sourceContext.sourcePageUrl,
    settings: sourceContext.settings,
  });

  if (!targetContext.ok) {
    return targetContext;
  }

  const preloadState = await loadPreloadState();

  if (isPreloadTab(preloadState, sourceContext.sourceTab.id)) {
    return { ok: false, reason: "preload-tab" };
  }

  if (
    options.requirePreloadingEnabled !== false &&
    sourceContext.settings.preloading.enabled !== true
  ) {
    return { ok: false, reason: "preloading-disabled" };
  }

  const forceNewTab = message?.forceNewTab === true;
  const targetHint = forceNewTab || message?.targetHint === "_blank" ? "_blank" : "_self";
  const trigger = message?.trigger === "contextmenu" ? "contextmenu" : "hover";

  return {
    ok: true,
    sourceTab: sourceContext.sourceTab,
    sourcePageUrl: sourceContext.sourcePageUrl,
    targetUrl: targetContext.targetUrl,
    targetHint,
    trigger,
    forceNewTab,
    settings: sourceContext.settings,
    realPreloadSafety: targetContext.realPreloadSafety,
  };
}
