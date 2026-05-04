(function () {
  // Background-side navigation supervisor for page click flows. Keep policy
  // here so the content script stays a thin DOM/event adapter.
  async function resolveClickNavigation(message, sender) {
    const sourceTab = sender?.tab ?? null;
    const sourcePageUrl =
      typeof message?.sourcePageUrl === "string" ? message.sourcePageUrl : sourceTab?.url || "";
    const targetUrl = typeof message?.targetUrl === "string" ? message.targetUrl : "";
    const targetHint = message?.targetHint === "_blank" ? "_blank" : "_self";
    const resolutionExpiresAt = normalizeClickResolutionDeadline(message?.resolutionExpiresAt);
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

    if (isClickResolutionDeadlineExpired(resolutionExpiresAt)) {
      globalThis.ZeroLatencyDebugEvents?.record?.("navigation.click.resolution.deadline-expired", {
        sourceTabId: sourceTab.id,
        sourcePageUrl: indexedSourcePageUrl,
        targetUrl,
        targetHint,
      });
      return {
        handled: false,
        action: targetHint === "_blank" ? "navigate-reserved-tab" : "navigate-current-tab",
        targetUrl,
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
            resolutionExpiresAt,
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

      await lockCurrentTabNavigationSource(sourceTab, indexedSourcePageUrl);
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
          resolutionExpiresAt,
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

  function normalizeClickResolutionDeadline(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
  }

  function isClickResolutionDeadlineExpired(deadline) {
    return Number.isFinite(deadline) && Date.now() >= deadline;
  }

  async function primeSourcePage(message, sender) {
    return globalThis.ZeroLatencyLearning.rememberSourcePage(message, sender);
  }

  async function lockCurrentTabNavigationSource(sourceTab, sourcePageUrl) {
    const normalizedSourcePageUrl = normalizePageUrlForIndex(sourcePageUrl || sourceTab?.url || "");

    if (!sourceTab?.id || !normalizedSourcePageUrl) {
      return;
    }

    const preloadState = await loadPreloadState();

    if (isPreloadTab(preloadState, sourceTab.id)) {
      return;
    }

    const trackingState = await loadTrackingState();
    const sourceTabId = String(sourceTab.id);
    const trackedSource = trackingState.tabState?.[sourceTabId] ?? null;
    const sourceNodeId = trackedSource?.nodeId ?? buildNodeSeed(normalizedSourcePageUrl).nodeId;
    const occurredAt = new Date().toISOString();

    trackingState.pendingSources[sourceTabId] = {
      nodeId: sourceNodeId,
      pageUrl: normalizedSourcePageUrl,
      createdAt: occurredAt,
    };

    await saveTrackingState(trackingState);
    globalThis.ZeroLatencyDiagnostics?.record?.("tracking.current-tab-source-lock.saved", {
      tabId: sourceTab.id,
      sourcePageUrl: normalizedSourcePageUrl,
      sourceNodeId,
    });
  }

  globalThis.ZeroLatencyNavigationManager = {
    primeSourcePage,
    recordLinkIntent,
    resolveClickNavigation,
  };
})();
