(function () {
  async function shouldSkipMessageForExcludedSource(actionKey, sender) {
    if (await shouldSkipMessageForExcludedIncognitoSource(actionKey, sender)) {
      return {
        ok: true,
        skipped: true,
        reason: "incognito-excluded",
      };
    }

    if (await shouldSkipMessageForProxySkippedSource(actionKey, sender)) {
      return {
        ok: true,
        skipped: true,
        reason: "proxy-skip",
      };
    }

    return null;
  }

  async function shouldSkipMessageForExcludedIncognitoSource(actionKey, sender) {
    if (!shouldApplySourceSkipToMessageAction(actionKey)) {
      return false;
    }

    const sourceTab = sender?.tab ?? null;

    if (
      globalThis.ZeroLatencyPreloadIncognitoPolicy?.shouldExcludeIncognitoPreloadSource?.(
        sourceTab,
        getEffectiveExtensionSettings()
      ) !== true
    ) {
      return false;
    }

    const preloadState = await loadPreloadState();
    const cleanup =
      await globalThis.ZeroLatencyPreloadIncognitoPolicy.clearExcludedIncognitoPreloadState(
        preloadState,
        getEffectiveExtensionSettings(),
        {
          tabs: [sourceTab],
          reason: `message:${actionKey}`,
        }
      );

    if (cleanup.mutated) {
      await savePreloadState(cleanup.preloadState);
    }

    globalThis.ZeroLatencyDebugEvents?.record?.("message.skip-incognito-source", {
      actionKey,
      sourceTabId: sourceTab?.id ?? null,
      sourceWindowId: sourceTab?.windowId ?? null,
      sourceUrl: sourceTab?.url || "",
    });
    return true;
  }

  async function shouldSkipMessageForProxySkippedSource(actionKey, sender) {
    if (!shouldApplySourceSkipToMessageAction(actionKey)) {
      return false;
    }

    const sourceTab = sender?.tab ?? null;

    if (
      globalThis.ZeroLatencyPreloadProxySkipPolicy?.shouldSkipProxyPreloadSource?.(
        sourceTab,
        getEffectiveExtensionSettings()
      ) !== true
    ) {
      return false;
    }

    const preloadState = await loadPreloadState();
    const cleanup =
      await globalThis.ZeroLatencyPreloadProxySkipPolicy.clearProxySkippedPreloadState(
        preloadState,
        getEffectiveExtensionSettings(),
        {
          tabs: [sourceTab],
          reason: `message:${actionKey}`,
        }
      );

    if (cleanup.mutated) {
      await savePreloadState(cleanup.preloadState);
    }

    globalThis.ZeroLatencyDebugEvents?.record?.("message.skip-proxy-source", {
      actionKey,
      sourceTabId: sourceTab?.id ?? null,
      sourceWindowId: sourceTab?.windowId ?? null,
      sourceUrl: sourceTab?.url || "",
    });
    return true;
  }

  function shouldApplySourceSkipToMessageAction(actionKey) {
    return [
      "register-preload-candidates",
      "preload-interaction-status",
      "preload-interaction-start",
      "preload-interaction-cancel",
      "report-foreground-page-digest",
      "record-attention-activity",
      "remember-source-page",
      "record-link-behavior",
      "navigation-prime-source",
      "navigation-record-link-intent",
      "navigation-resolve-click",
      "activate-preloaded-page",
    ].includes(actionKey);
  }

  globalThis.ZeroLatencyMessageActionSourceSkip = {
    shouldSkipMessageForExcludedSource,
    shouldSkipMessageForExcludedIncognitoSource,
    shouldSkipMessageForProxySkippedSource,
    shouldApplySourceSkipToMessageAction,
  };
})();
