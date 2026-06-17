async function resolvePreloadWindowEnsureContext(normalWindowId) {
  if (globalThis.ZeroLatencySupport?.supportsHiddenTabPreloadRuntime?.() !== true) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.ensure.unsupported", {
      normalWindowId,
    });
    return {
      ok: false,
      response: {
        windowId: null,
        created: false,
        supported: false,
      },
    };
  }

  const runtimeSettings =
    typeof getEffectiveExtensionSettings === "function"
      ? getEffectiveExtensionSettings()
      : null;

  if (
    globalThis.ZeroLatencyPreloadNativeOnlyPolicy?.isAllNativePreloadModeEnabled?.(
      runtimeSettings
    ) === true
  ) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.ensure.native-only-skip", {
      normalWindowId,
    });
    return {
      ok: false,
      response: {
        windowId: null,
        created: false,
        supported: false,
        reason: "real-preload-disabled",
      },
    };
  }

  const sourceWindowContext =
    await globalThis.ZeroLatencyPreloadIncognitoPolicy?.resolvePreloadWindowSourceContext?.(
      normalWindowId,
      runtimeSettings
    );

  if (sourceWindowContext && sourceWindowContext.ok !== true) {
    globalThis.ZeroLatencyDebugEvents?.record?.("preload-window.ensure.skip-source-context", {
      normalWindowId,
      reason: sourceWindowContext.reason,
      sourceIncognito: sourceWindowContext.incognito === true,
    });
    return {
      ok: false,
      response: {
        windowId: null,
        created: false,
        supported: false,
        reason: sourceWindowContext.reason,
      },
    };
  }

  return {
    ok: true,
    runtimeSettings,
    sourceWindowIncognito: sourceWindowContext?.incognito === true,
    useSystemHiding: await resolveSystemHidingUsableForPreloadWindow(),
  };
}
