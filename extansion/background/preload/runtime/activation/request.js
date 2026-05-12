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

  return {
    ok: true,
    sourceTab,
    sourceTabId: String(sourceTab.id),
    openInNewTab,
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
