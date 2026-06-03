async function resolvePreloadActivationRequest(message, sender) {
  if (await isExtensionServicePaused()) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.service-paused", {
      targetUrl: message?.url || null,
    });
    return { ok: false, response: { handled: false } };
  }

  if (globalThis.ZeroLatencySupport?.supportsHiddenTabPreloadRuntime?.() !== true) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.unsupported", {
      targetUrl: message?.url || null,
    });
    return { ok: false, response: { handled: false } };
  }

  const sourceTab = sender?.tab;
  const openInNewTab = message?.openInNewTab === true;
  const targetWindowId = normalizePositiveInteger(message?.targetWindowId);
  const targetIndex = normalizePositiveInteger(message?.targetIndex);
  const resolutionExpiresAt = normalizeActivationDeadline(message?.resolutionExpiresAt);

  if (!sourceTab?.id || !sourceTab.windowId || !isTrackableAndAllowedUrl(message?.url || "")) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.invalid-request", {
      sourceTabId: sourceTab?.id ?? null,
      sourceWindowId: sourceTab?.windowId ?? null,
      targetUrl: message?.url || null,
      openInNewTab,
    });
    return { ok: false, response: { handled: false } };
  }

  if (
    isActivationDeadlineExpired(resolutionExpiresAt, {
      sourceTab,
      targetUrl: message.url,
      openInNewTab,
      stage: "before-resolution",
    })
  ) {
    return { ok: false, response: { handled: false } };
  }

  const sourceWindow = await getWindowMaybe(sourceTab.windowId);

  if (sourceWindow?.type !== "normal") {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.invalid-source-window", {
      sourceTabId: sourceTab.id,
      sourceWindowId: sourceTab.windowId,
      targetUrl: message.url,
      sourceWindowType: sourceWindow?.type || null,
    });
    return { ok: false, response: { handled: false } };
  }

  const runtimeSettings =
    typeof getEffectiveExtensionSettings === "function"
      ? getEffectiveExtensionSettings()
      : null;
  const sourceIncognitoTab = {
    ...sourceTab,
    incognito: sourceTab.incognito === true || sourceWindow.incognito === true,
  };

  if (
    globalThis.ZeroLatencyPreloadIncognitoPolicy?.shouldExcludeIncognitoPreloadSource?.(
      sourceIncognitoTab,
      runtimeSettings
    ) === true
  ) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.incognito-excluded", {
      sourceTabId: sourceTab.id,
      sourceWindowId: sourceTab.windowId,
      targetUrl: message.url,
    });
    return { ok: false, response: { handled: false, reason: "incognito-excluded" } };
  }

  if (targetWindowId !== null) {
    const targetWindow = await getWindowMaybe(targetWindowId);
    const incognitoMatch =
      globalThis.ZeroLatencyPreloadIncognitoPolicy?.resolveSourceTargetIncognitoMatch?.(
        sourceIncognitoTab,
        null,
        targetWindow
      );

    if (incognitoMatch?.matches === false) {
      globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.incognito-mismatch", {
        sourceTabId: sourceTab.id,
        sourceWindowId: sourceTab.windowId,
        targetWindowId,
        targetUrl: message.url,
        sourceIncognito: incognitoMatch.sourceIncognito,
        targetIncognito: incognitoMatch.targetIncognito,
      });
      return { ok: false, response: { handled: false, reason: "incognito-context-mismatch" } };
    }
  }

  return {
    ok: true,
    sourceTab,
    sourceTabId: String(sourceTab.id),
    openInNewTab,
    targetWindowId,
    targetIndex,
    resolutionExpiresAt,
    targetUrl: message.url,
  };
}

function normalizeActivationDeadline(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
}

function isActivationDeadlineExpired(deadline, logContext = null) {
  const expired = Number.isFinite(deadline) && Date.now() >= deadline;

  if (expired && logContext) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-activation.deadline-expired", {
      sourceTabId: logContext.sourceTab?.id ?? null,
      sourceWindowId: logContext.sourceTab?.windowId ?? null,
      targetUrl: logContext.targetUrl,
      openInNewTab: logContext.openInNewTab === true,
      stage: logContext.stage,
    });
  }

  return expired;
}
