(function () {
  const USER_NAVIGATION_OVERRIDE_TTL_MS = 10_000;
  const recentUserNavigationOverrides = new Map();

  async function rememberSourcePage(message, sender) {
    const sourceTab = sender?.tab;
    const pageUrl = typeof message?.pageUrl === "string" ? message.pageUrl : sourceTab?.url || "";

    if (!sourceTab?.id || !isTrackableAndAllowedUrl(pageUrl)) {
      return { ok: true, skipped: true };
    }

    const preloadState = await loadPreloadState();

    if (isPreloadTab(preloadState, sourceTab.id)) {
      return { ok: true, skipped: true };
    }

    const trackingState = await loadTrackingState();
    const trackedEntry = trackingState.tabState[String(sourceTab.id)] ?? null;
    const trackedPageUrl = normalizePageUrlForIndex(trackedEntry?.url || "");
    const normalizedPageUrl = normalizePageUrlForIndex(pageUrl);

    if (!normalizedPageUrl || trackedPageUrl === normalizedPageUrl) {
      return { ok: true, skipped: true };
    }

    const nextTrackingState = await applyTrackingEvent(trackingState, {
      type: "set-current-page",
      tabId: String(sourceTab.id),
      targetNode: buildNodeSeed(normalizedPageUrl),
      occurredAt: new Date().toISOString(),
      url: normalizedPageUrl,
    });

    await saveTrackingState(nextTrackingState);
    return { ok: true };
  }

  async function recordLinkBehavior(message, sender) {
    const sourceTab = sender?.tab;
    const sourcePageUrl = normalizePageUrlForIndex(
      typeof message?.sourcePageUrl === "string" ? message.sourcePageUrl : sourceTab?.url || ""
    );
    const targetUrl = normalizePageUrlForIndex(message?.targetUrl || "");

    if (!sourceTab?.id || !sourcePageUrl || !targetUrl) {
      return { ok: true, skipped: true };
    }

    if (isExcludedGooglePage(sourcePageUrl) || isExcludedGooglePage(targetUrl)) {
      return { ok: true, skipped: true };
    }

    const preloadState = await loadPreloadState();

    if (isPreloadTab(preloadState, sourceTab.id)) {
      return { ok: true, skipped: true };
    }

    const trackingState = await loadTrackingState();
    const nextTrackingState = await applyTrackingEvent(trackingState, {
      type: "record-link-behavior",
      sourcePageUrl,
      targetUrl,
      targetHint: message?.targetHint === "_blank" ? "_blank" : "_self",
      occurredAt: new Date().toISOString(),
    });
    await saveTrackingState(nextTrackingState);
    return { ok: true };
  }

  async function noteUserNavigationOverride(message, sender) {
    const sourceTabId = String(sender?.tab?.id || "");
    const targetUrl = normalizePageUrlForIndex(message?.targetUrl || "");
    const targetHint = message?.targetHint === "_blank" ? "_blank" : "_self";

    if (!sourceTabId || !targetUrl || targetHint !== "_blank") {
      return { ok: true, skipped: true };
    }

    pruneRecentUserNavigationOverrides();
    recentUserNavigationOverrides.set(buildUserNavigationOverrideKey(sourceTabId, targetUrl), {
      expiresAt: Date.now() + USER_NAVIGATION_OVERRIDE_TTL_MS,
    });

    return { ok: true };
  }

  async function applyCreatedNavigationTargetLinkBehavior(trackingState, details) {
    const targetUrl = normalizePageUrlForIndex(details?.url || "");

    if (
      consumeRecentUserNavigationOverride(String(details?.sourceTabId || ""), targetUrl)
    ) {
      return trackingState;
    }

    const sourcePageUrl = normalizePageUrlForIndex(
      trackingState?.tabState?.[String(details.sourceTabId)]?.url || ""
    );

    if (!sourcePageUrl) {
      return trackingState;
    }

    return applyTrackingEvent(trackingState, {
      type: "record-link-behavior",
      sourcePageUrl,
      targetUrl: details.url,
      targetHint: "_blank",
      occurredAt: toIsoTimestamp(details.timeStamp),
    });
  }

  globalThis.ZeroLatencyLearningLinkBehavior = {
    rememberSourcePage,
    recordLinkBehavior,
    noteUserNavigationOverride,
    applyCreatedNavigationTargetLinkBehavior,
  };

  function buildUserNavigationOverrideKey(sourceTabId, targetUrl) {
    return `${sourceTabId}|${targetUrl}`;
  }

  function consumeRecentUserNavigationOverride(sourceTabId, targetUrl) {
    if (!sourceTabId || !targetUrl) {
      return false;
    }

    pruneRecentUserNavigationOverrides();

    const key = buildUserNavigationOverrideKey(sourceTabId, targetUrl);
    const entry = recentUserNavigationOverrides.get(key);

    if (!entry || entry.expiresAt <= Date.now()) {
      recentUserNavigationOverrides.delete(key);
      return false;
    }

    recentUserNavigationOverrides.delete(key);
    return true;
  }

  function pruneRecentUserNavigationOverrides() {
    const now = Date.now();

    for (const [key, entry] of recentUserNavigationOverrides.entries()) {
      if (!entry || entry.expiresAt <= now) {
        recentUserNavigationOverrides.delete(key);
      }
    }
  }
})();
