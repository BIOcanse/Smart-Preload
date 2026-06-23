(function () {
  const {
    buildPreloadAttentionRuntimeOptions,
    resolveAttentionActivity,
  } = globalThis.ZeroLatencyPreloadAttentionActivity;
  const {
    normalizeAttentionPageUrl,
  } = globalThis.ZeroLatencyPreloadAttentionPool;

  async function resolveActiveTabAttentionObservation(
    tab,
    reason = "active-tab",
    options = {}
  ) {
    const tabId = normalizePositiveInteger(tab?.id);
    const windowId = normalizePositiveInteger(tab?.windowId);

    if (tabId === null || windowId === null) {
      return null;
    }

    const sourceWindow = await getWindowMaybe(windowId);
    const pageUrl = normalizeAttentionPageUrl(tab?.url || "");
    const runtimeOptions = buildPreloadAttentionRuntimeOptions(options);
    const activity = resolveAttentionActivity(options?.activity, runtimeOptions);
    const settings =
      typeof getEffectiveExtensionSettings === "function"
        ? getEffectiveExtensionSettings()
        : null;
    const incognitoExcluded =
      globalThis.ZeroLatencyPreloadIncognitoPolicy?.shouldExcludeIncognitoPreloadSource?.(
        {
          ...tab,
          incognito: tab?.incognito === true || sourceWindow?.incognito === true,
        },
        settings
      ) === true;
    const proxySkipped =
      globalThis.ZeroLatencyPreloadProxySkipPolicy?.shouldSkipProxyPreloadSource?.(
        tab,
        settings
      ) === true;
    const canCount =
      runtimeOptions.enabled !== false &&
      sourceWindow?.type === "normal" &&
      sourceWindow?.focused === true &&
      tab?.active === true &&
      incognitoExcluded !== true &&
      proxySkipped !== true &&
      pageUrl &&
      isTrackableAndAllowedUrl(pageUrl) &&
      activity.weight > 0;

    return {
      tabId,
      runtimeOptions,
      observation: {
        tabId,
        windowId,
        pageUrl,
        observedAt: new Date().toISOString(),
        counting: canCount,
        weight: canCount ? activity.weight : 0,
        activityKind:
          runtimeOptions.enabled === false
            ? "disabled"
            : canCount
              ? activity.kind
              : "inactive",
        expiresAt: canCount ? activity.expiresAt : null,
        reason,
      },
    };
  }

  globalThis.ZeroLatencyPreloadAttentionRuntimeSource = {
    resolveActiveTabAttentionObservation,
  };
})();
