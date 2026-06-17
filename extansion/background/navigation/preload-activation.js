(function () {
  async function tryActivateClickPreload(options, sender) {
    const channel = options.channel;

    globalThis.ZeroLatencyDebugEvents?.record?.(
      `navigation.click.${channel}.activation-attempt`,
      {
        sourceTabId: options.sourceTab?.id ?? null,
        sourcePageUrl: options.indexedSourcePageUrl,
        targetUrl: options.targetUrl,
      }
    );

    const activation = await globalThis.ZeroLatencyPreloadRuntimeManager.activateIfReady(
      {
        url: options.targetUrl,
        openInNewTab: options.openInNewTab === true,
        resolutionExpiresAt: options.resolutionExpiresAt,
      },
      sender
    );

    if (activation?.handled === true) {
      globalThis.ZeroLatencyDebugEvents?.record?.(
        `navigation.click.${channel}.activation-hit`,
        {
          sourceTabId: options.sourceTab?.id ?? null,
          sourcePageUrl: options.indexedSourcePageUrl,
          targetUrl: options.targetUrl,
          activatedTabId: activation?.tabId ?? null,
        }
      );
      return {
        handled: true,
        action: "preload-activated",
      };
    }

    globalThis.ZeroLatencyDebugEvents?.record?.(
      `navigation.click.${channel}.activation-miss`,
      {
        sourceTabId: options.sourceTab?.id ?? null,
        sourcePageUrl: options.indexedSourcePageUrl,
        targetUrl: options.targetUrl,
      }
    );

    return {
      handled: false,
    };
  }

  globalThis.ZeroLatencyNavigationPreloadActivation = {
    tryActivateClickPreload,
  };
})();
