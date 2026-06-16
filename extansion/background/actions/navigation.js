(function () {
  async function executeNavigationDecision(decision, envelope) {
    if (!decision) {
      return;
    }

    if (decision.disposition === "ignore") {
      return;
    }

    switch (decision.actionKey) {
      case "record-visit":
        if (await shouldSkipNavigationForExcludedSourceTab(envelope.raw.tabId, "record-visit")) {
          return;
        }
        await recordVisit(envelope.raw, decision.metadata?.sourceEvent || "committed");
        await globalThis.ZeroLatencyPreloadSchedulerAttention?.recordActiveTabAttentionFromNavigationDetails?.(
          envelope.raw,
          decision.metadata?.sourceEvent || "committed",
          { queue: false }
        );
        return;
      case "set-current-page":
        if (
          await shouldSkipNavigationForExcludedSourceTab(
            envelope.raw.tabId,
            "set-current-page"
          )
        ) {
          return;
        }
        await setCurrentPageFromVisit(
          envelope.raw,
          decision.metadata?.sourceEvent || "committed"
        );
        await globalThis.ZeroLatencyPreloadSchedulerAttention?.recordActiveTabAttentionFromNavigationDetails?.(
          envelope.raw,
          decision.metadata?.sourceEvent || "committed",
          { queue: false }
        );
        return;
      case "record-created-navigation-target":
        await recordCreatedNavigationTarget(envelope.raw);
        return;
      case "record-tab-replacement":
        if (
          (await shouldSkipNavigationForExcludedSourceTab(
            envelope.raw.tabId,
            "tab-replacement-new"
          )) ||
          (await shouldSkipNavigationForExcludedSourceTab(
            envelope.raw.replacedTabId,
            "tab-replacement-old"
          ))
        ) {
          return;
        }
        await recordTabReplacement(envelope.raw);
        return;
      case "handle-created-tab":
        {
          if (envelope.raw.openerTabId == null) {
            return;
          }

          const fallbackActivation =
            await globalThis.ZeroLatencyPreloadRuntimeManager.activateUpdatedTabNavigationTarget?.({
              tabId: envelope.raw.id,
              changeInfo: {
                url: envelope.raw.pendingUrl || envelope.raw.url || "",
              },
              tab: envelope.raw,
            });
          const fallbackPayload = {
            tabId: envelope.raw.id,
            openerTabId: envelope.raw.openerTabId ?? null,
            url: envelope.raw.pendingUrl || envelope.raw.url || "",
            handled: fallbackActivation?.handled === true,
            reason: fallbackActivation?.reason ?? null,
            debug: fallbackActivation?.debug ?? null,
            activatedTabId: fallbackActivation?.tabId ?? null,
          };
          globalThis.ZeroLatencyDiagnostics?.record?.(
            "tracking.tab-created.contextmenu-preload-fallback",
            fallbackPayload
          );
          globalThis.ZeroLatencyDebugEvents?.record?.(
            "tracking.tab-created.contextmenu-preload-fallback",
            fallbackPayload
          );

          if (fallbackActivation?.handled === true) {
            const activationPayload = {
              tabId: envelope.raw.id,
              openerTabId: envelope.raw.openerTabId ?? null,
              url: envelope.raw.pendingUrl || envelope.raw.url || "",
              activatedTabId: fallbackActivation.tabId ?? null,
            };
            globalThis.ZeroLatencyDiagnostics?.record?.(
              "tracking.tab-created.contextmenu-preload-activated",
              activationPayload
            );
            globalThis.ZeroLatencyDebugEvents?.record?.(
              "tracking.tab-created.contextmenu-preload-activated",
              activationPayload
            );
          }
        }
        return;
      case "handle-removed-tab":
        await handleRemovedTab(envelope.raw.tabId);
        await globalThis.ZeroLatencyPreloadSchedulerAttention?.pausePreloadAttentionCursorIfMatches?.(
          { tabId: envelope.raw.tabId },
          "tab-removed",
          { queue: false }
        );
        return;
      case "update-preloaded-tab-status":
        {
          const fallbackUrl =
            envelope.raw.changeInfo?.url ?? envelope.raw.tab?.pendingUrl ?? envelope.raw.tab?.url ?? "";

          if (envelope.raw.tab?.openerTabId != null) {
            const fallbackActivation =
              await globalThis.ZeroLatencyPreloadRuntimeManager.activateUpdatedTabNavigationTarget?.(
                envelope.raw
              );

            const fallbackPayload = {
              tabId: envelope.raw.tabId,
              openerTabId: envelope.raw.tab?.openerTabId ?? null,
              url: fallbackUrl,
              handled: fallbackActivation?.handled === true,
              reason: fallbackActivation?.reason ?? null,
              debug: fallbackActivation?.debug ?? null,
              activatedTabId: fallbackActivation?.tabId ?? null,
            };
            globalThis.ZeroLatencyDiagnostics?.record?.(
              "tracking.tab-updated.contextmenu-preload-fallback",
              fallbackPayload
            );
            globalThis.ZeroLatencyDebugEvents?.record?.(
              "tracking.tab-updated.contextmenu-preload-fallback",
              fallbackPayload
            );

            if (fallbackActivation?.handled === true) {
              const activationPayload = {
                tabId: envelope.raw.tabId,
                openerTabId: envelope.raw.tab?.openerTabId ?? null,
                url: fallbackUrl,
                activatedTabId: fallbackActivation.tabId ?? null,
              };
              globalThis.ZeroLatencyDiagnostics?.record?.(
                "tracking.tab-updated.contextmenu-preload-activated",
                activationPayload
              );
              globalThis.ZeroLatencyDebugEvents?.record?.(
                "tracking.tab-updated.contextmenu-preload-activated",
                activationPayload
              );
              return;
            }
          }
        }
        await updatePreloadedTabStatus(
          envelope.raw.tabId,
          envelope.raw.changeInfo,
          envelope.raw.tab
        );
        return;
      case "handle-activated-tab":
        await globalThis.ZeroLatencyPreloadSchedulerAttention?.recordActiveTabAttentionFromActiveInfo?.(
          envelope.raw,
          "tab-activated",
          { queue: false }
        );
        await globalThis.ZeroLatencyPreloadSourceTabs.handleActivatedSourceTab(envelope.raw);
        return;
      case "handle-removed-window":
        await globalThis.ZeroLatencyPreloadWindowManager.handleRemovedWindowEvent(
          envelope.raw.windowId
        );
        await globalThis.ZeroLatencyPreloadSchedulerAttention?.pausePreloadAttentionCursorIfMatches?.(
          { windowId: envelope.raw.windowId },
          "window-removed",
          { queue: false }
        );
        return;
      case "handle-focused-window":
        await globalThis.ZeroLatencyPreloadSchedulerAttention?.recordActiveTabAttentionFromFocusedWindow?.(
          envelope.raw.windowId,
          "window-focused",
          { queue: false }
        );
        return;
      case "handle-preload-window-bounds-changed":
        await globalThis.ZeroLatencyPreloadWindowManager.handleBoundsChangedEvent(
          envelope.raw.window
        );
        return;
      case "run-preload-watchdog":
        await globalThis.ZeroLatencyPreloadRuntimeManager.maintain();
        return;
      case "run-preload-cleanup":
        await globalThis.ZeroLatencyPreloadRuntimeManager.cleanupErroneousWindows();
        return;
      case "run-lmstudio-lifecycle-watchdog":
        await globalThis.ZeroLatencyAiProviders?.maintainLmStudioModelLifecycle?.();
        return;
      case "send-native-app-heartbeat":
        await globalThis.ZeroLatencyNativeAppHeartbeat?.send?.("alarm");
        return;
      case "run-native-app-wake-retry":
        await globalThis.ZeroLatencyNativeAppHeartbeat?.runWakeRetry?.("alarm");
        return;
      default:
        return;
    }
  }

  async function shouldSkipNavigationForExcludedSourceTab(tabId, reason) {
    const normalizedTabId = normalizePositiveInteger(tabId);

    if (normalizedTabId === null) {
      return false;
    }

    const tab = await getTabMaybe(normalizedTabId);

    if (
      globalThis.ZeroLatencyPreloadIncognitoPolicy?.shouldExcludeIncognitoPreloadSource?.(
        tab,
        getEffectiveExtensionSettings()
      ) === true
    ) {
      globalThis.ZeroLatencyDebugEvents?.record?.("navigation.skip-incognito-source", {
        tabId: normalizedTabId,
        windowId: tab?.windowId ?? null,
        url: tab?.url || "",
        reason,
      });
      return true;
    }

    if (
      globalThis.ZeroLatencyPreloadProxySkipPolicy?.shouldSkipProxyPreloadSource?.(
        tab,
        getEffectiveExtensionSettings()
      ) !== true
    ) {
      return false;
    }

    globalThis.ZeroLatencyDebugEvents?.record?.("navigation.skip-proxy-source", {
      tabId: normalizedTabId,
      windowId: tab?.windowId ?? null,
      url: tab?.url || "",
      reason,
    });
    return true;
  }

  globalThis.ZeroLatencyNavigationActions = {
    executeNavigationDecision,
  };
})();
