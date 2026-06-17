(function () {
  const clickContext = globalThis.ZeroLatencyNavigationClickContext;
  const preloadActivation = globalThis.ZeroLatencyNavigationPreloadActivation;
  const currentTabSource = globalThis.ZeroLatencyNavigationCurrentTabSource;

  async function resolveClickNavigation(message, sender) {
    const context = clickContext.buildClickNavigationContext(message, sender);

    if (!context.isValid) {
      return {
        handled: false,
        action: "skip",
      };
    }

    if (
      isExcludedTrackingPage(context.sourcePageUrl) ||
      isExcludedTrackingPage(context.targetUrl)
    ) {
      return {
        handled: false,
        action: "skip",
      };
    }

    if (clickContext.isClickResolutionDeadlineExpired(context.resolutionExpiresAt)) {
      globalThis.ZeroLatencyDebugEvents?.record?.(
        "navigation.click.resolution.deadline-expired",
        {
          sourceTabId: context.sourceTab.id,
          sourcePageUrl: context.indexedSourcePageUrl,
          targetUrl: context.targetUrl,
          targetHint: context.targetHint,
        }
      );
      return {
        handled: false,
        action:
          context.targetHint === "_blank"
            ? "navigate-reserved-tab"
            : "navigate-current-tab",
        targetUrl: context.targetUrl,
      };
    }

    await globalThis.ZeroLatencyLearning.rememberSourcePage(
      {
        pageUrl: context.indexedSourcePageUrl,
      },
      sender
    );
    await globalThis.ZeroLatencyLearning.recordLinkBehavior(
      {
        sourcePageUrl: context.indexedSourcePageUrl,
        targetUrl: context.indexedTargetUrl,
        targetHint: context.targetHint,
      },
      sender
    );

    if (context.targetHint === "_self") {
      if (!context.isSameOriginNavigation) {
        const activation = await preloadActivation.tryActivateClickPreload(
          {
            channel: "cross-site-current-tab",
            sourceTab: context.sourceTab,
            indexedSourcePageUrl: context.indexedSourcePageUrl,
            targetUrl: context.targetUrl,
            openInNewTab: false,
            resolutionExpiresAt: context.resolutionExpiresAt,
          },
          sender
        );

        if (activation.handled) {
          return activation;
        }
      }

      await currentTabSource.lockCurrentTabNavigationSource(
        context.sourceTab,
        context.indexedSourcePageUrl
      );
      return {
        handled: false,
        action: "navigate-current-tab",
        targetUrl: context.targetUrl,
      };
    }

    if (context.targetHint === "_blank" && !context.isSameOriginNavigation) {
      const activation = await preloadActivation.tryActivateClickPreload(
        {
          channel: "cross-site-new-tab",
          sourceTab: context.sourceTab,
          indexedSourcePageUrl: context.indexedSourcePageUrl,
          targetUrl: context.targetUrl,
          openInNewTab: true,
          resolutionExpiresAt: context.resolutionExpiresAt,
        },
        sender
      );

      if (activation.handled) {
        return activation;
      }

      return {
        handled: false,
        action: "navigate-reserved-tab",
        targetUrl: context.targetUrl,
      };
    }

    return {
      handled: false,
      action: "allow-browser-default",
      targetUrl: context.targetUrl,
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
