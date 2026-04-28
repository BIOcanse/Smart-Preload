(function () {
  // Background-side navigation supervisor for page click flows. Keep policy
  // here so the content script stays a thin DOM/event adapter.
  async function resolveClickNavigation(message, sender) {
    const sourceTab = sender?.tab ?? null;
    const sourcePageUrl =
      typeof message?.sourcePageUrl === "string" ? message.sourcePageUrl : sourceTab?.url || "";
    const targetUrl = typeof message?.targetUrl === "string" ? message.targetUrl : "";
    const targetHint = message?.targetHint === "_blank" ? "_blank" : "_self";
    const indexedSourcePageUrl = normalizePageUrlForIndex(sourcePageUrl);
    const indexedTargetUrl = normalizePageUrlForIndex(targetUrl);

    if (!sourceTab?.id || !targetUrl || !indexedSourcePageUrl || !indexedTargetUrl) {
      return {
        handled: false,
        action: "skip",
      };
    }

    if (isExcludedGooglePage(sourcePageUrl) || isExcludedGooglePage(targetUrl)) {
      return {
        handled: false,
        action: "skip",
      };
    }

    await globalThis.ZeroLatencyLearning.rememberSourcePage(
      {
        pageUrl: indexedSourcePageUrl,
      },
      sender
    );
    await globalThis.ZeroLatencyLearning.recordLinkBehavior(
      {
        sourcePageUrl: indexedSourcePageUrl,
        targetUrl: indexedTargetUrl,
        targetHint,
      },
      sender
    );

    const sameOriginNavigation = isSameOriginUrl(sourcePageUrl, targetUrl);

    if (targetHint === "_self") {
      if (!sameOriginNavigation) {
        globalThis.ZeroLatencyDebugEvents?.record?.(
          "navigation.click.cross-site-current-tab.activation-attempt",
          {
            sourceTabId: sourceTab.id,
            sourcePageUrl: indexedSourcePageUrl,
            targetUrl,
          }
        );
        const activation = await globalThis.ZeroLatencyPreloadRuntimeManager.activateIfReady(
          {
            url: targetUrl,
            openInNewTab: false,
          },
          sender
        );

        if (activation?.handled === true) {
          globalThis.ZeroLatencyDebugEvents?.record?.(
            "navigation.click.cross-site-current-tab.activation-hit",
            {
              sourceTabId: sourceTab.id,
              sourcePageUrl: indexedSourcePageUrl,
              targetUrl,
              activatedTabId: activation?.tabId ?? null,
            }
          );
          return {
            handled: true,
            action: "preload-activated",
          };
        }

        globalThis.ZeroLatencyDebugEvents?.record?.(
          "navigation.click.cross-site-current-tab.activation-miss",
          {
            sourceTabId: sourceTab.id,
            sourcePageUrl: indexedSourcePageUrl,
            targetUrl,
          }
        );
      }

      return {
        handled: false,
        action: "navigate-current-tab",
        targetUrl,
      };
    }

    if (targetHint === "_blank" && !sameOriginNavigation) {
      globalThis.ZeroLatencyDebugEvents?.record?.(
        "navigation.click.cross-site-new-tab.activation-attempt",
        {
          sourceTabId: sourceTab.id,
          sourcePageUrl: indexedSourcePageUrl,
          targetUrl,
        }
      );
      const activation = await globalThis.ZeroLatencyPreloadRuntimeManager.activateIfReady(
        {
          url: targetUrl,
          openInNewTab: true,
        },
        sender
      );

      if (activation?.handled === true) {
        globalThis.ZeroLatencyDebugEvents?.record?.(
          "navigation.click.cross-site-new-tab.activation-hit",
          {
            sourceTabId: sourceTab.id,
            sourcePageUrl: indexedSourcePageUrl,
            targetUrl,
            activatedTabId: activation?.tabId ?? null,
          }
        );
        return {
          handled: true,
          action: "preload-activated",
        };
      }

      globalThis.ZeroLatencyDebugEvents?.record?.(
        "navigation.click.cross-site-new-tab.activation-miss",
        {
          sourceTabId: sourceTab.id,
          sourcePageUrl: indexedSourcePageUrl,
          targetUrl,
        }
      );

      return {
        handled: false,
        action: "navigate-reserved-tab",
        targetUrl,
      };
    }

    return {
      handled: false,
      action: "allow-browser-default",
      targetUrl,
    };
  }

  async function recordLinkIntent(message, sender) {
    if (message?.skipBehaviorLearning === true || message?.userOverride === true) {
      return globalThis.ZeroLatencyLearning.noteUserNavigationOverride(message, sender);
    }

    return globalThis.ZeroLatencyLearning.recordLinkBehavior(message, sender);
  }

  async function primeSourcePage(message, sender) {
    return globalThis.ZeroLatencyLearning.rememberSourcePage(message, sender);
  }

  globalThis.ZeroLatencyNavigationManager = {
    primeSourcePage,
    recordLinkIntent,
    resolveClickNavigation,
  };
})();
