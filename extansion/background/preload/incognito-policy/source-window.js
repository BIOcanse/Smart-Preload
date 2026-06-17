(function () {
  const incognitoMatch = globalThis.ZeroLatencyPreloadIncognitoMatch;

  async function resolvePreloadWindowSourceContext(normalWindowId, settings = null) {
    const normalizedWindowId = normalizePositiveInteger(normalWindowId);

    if (normalizedWindowId === null) {
      return {
        ok: false,
        reason: "invalid-source-window",
        sourceWindow: null,
        incognito: false,
      };
    }

    const sourceWindow = await getWindowMaybe(normalizedWindowId);

    if (!sourceWindow || sourceWindow.type !== "normal") {
      return {
        ok: false,
        reason: "invalid-source-window",
        sourceWindow: sourceWindow ?? null,
        incognito: false,
      };
    }

    if (
      sourceWindow.incognito === true &&
      incognitoMatch.isIncognitoPreloadExclusionEnabled(settings)
    ) {
      return {
        ok: false,
        reason: "incognito-excluded",
        sourceWindow,
        incognito: true,
      };
    }

    return {
      ok: true,
      sourceWindow,
      incognito: sourceWindow.incognito === true,
    };
  }

  globalThis.ZeroLatencyPreloadIncognitoSourceWindow = {
    resolvePreloadWindowSourceContext,
  };
})();
