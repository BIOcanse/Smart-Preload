async function synchronizeScheduledPreloadSelection(preloadState, scheduledSelection) {
  recordSchedulerRuntimeSyncEvent("scheduler.sync.source", {
    sourceTabId: scheduledSelection.sourceTabId,
    sourceWindowId: scheduledSelection.sourceWindowId,
    sourcePageUrl: scheduledSelection.sourcePageUrl,
    nativeSlots: scheduledSelection.nativeSlots,
    tabSlots: scheduledSelection.tabSlots,
    selectedCounts: countSchedulerSelectionTargets(scheduledSelection.selection),
  });
  return globalThis.ZeroLatencyPreloadDiff.applySourceTabSelection({
    preloadState,
    sourceWindowId: scheduledSelection.sourceWindowId,
    sourceTabId: scheduledSelection.sourceTabId,
    selection: scheduledSelection.selection,
  });
}

async function synchronizeChangedScheduledPreloadSelections(
  preloadState,
  scheduledSelections
) {
  let nextPreloadState = preloadState;
  const changedSelections = [];

  for (const scheduledSelection of Array.isArray(scheduledSelections)
    ? scheduledSelections
    : []) {
    if (!doesScheduledPreloadSelectionDiffer(nextPreloadState, scheduledSelection)) {
      recordSchedulerRuntimeSyncEvent("scheduler.sync.source-unchanged", {
        sourceTabId: scheduledSelection.sourceTabId,
        sourceWindowId: scheduledSelection.sourceWindowId,
        sourcePageUrl: scheduledSelection.sourcePageUrl,
      });
      continue;
    }

    nextPreloadState = await synchronizeScheduledPreloadSelection(
      nextPreloadState,
      scheduledSelection
    );
    changedSelections.push(scheduledSelection);
  }

  return {
    preloadState: nextPreloadState,
    changedSelections,
  };
}

function doesScheduledPreloadSelectionDiffer(preloadState, scheduledSelection) {
  const expectedFingerprint = buildScheduledPreloadSelectionFingerprint(
    scheduledSelection?.selection
  );
  const appliedFingerprint = buildAppliedPreloadSelectionFingerprint(
    preloadState,
    scheduledSelection
  );
  return appliedFingerprint === null || expectedFingerprint !== appliedFingerprint;
}

function buildScheduledPreloadSelectionFingerprint(selection) {
  return buildPreloadSelectionFingerprint(
    (Array.isArray(selection?.selectedTargets) ? selection.selectedTargets : []).map(
      (target) => ({
        strategy: target?.strategy,
        url: target?.url,
        nodeId: target?.nodeId,
        score: target?.score,
        targetHint: target?.targetHint,
        bookmarkPreload: target?.bookmarkPreload,
        scoreBreakdown: target?.scoreBreakdown,
        transitionMetrics: target?.transitionMetrics,
        aiKeywordMatch: target?.aiKeywordMatch,
        realPreloadSafety: target?.realPreloadSafety,
        siteSelection: target?.siteSelection,
      })
    )
  );
}

function buildAppliedPreloadSelectionFingerprint(preloadState, scheduledSelection) {
  if (
    typeof globalThis.findSourceTabRuntime !== "function" ||
    typeof globalThis.getSourceTabPreloadChannelStore !== "function"
  ) {
    return null;
  }

  const sourceRuntimeEntry = globalThis.findSourceTabRuntime(
    preloadState,
    scheduledSelection?.sourceTabId
  );

  if (
    sourceRuntimeEntry &&
    Number(sourceRuntimeEntry.normalWindowId) !== Number(scheduledSelection?.sourceWindowId)
  ) {
    return null;
  }

  const sourceRuntime = sourceRuntimeEntry?.sourceTabRuntime;

  if (!sourceRuntime) {
    return "[]";
  }

  const appliedTargets = [];

  for (const [channel, strategy] of [
    ["hiddenTab", "hidden-tab"],
    ["prerender", "prerender"],
    ["prefetch", "prefetch"],
  ]) {
    for (const [url, entry] of Object.entries(
      globalThis.getSourceTabPreloadChannelStore(sourceRuntime, channel)
    )) {
      if (entry?.interactionPreload) {
        continue;
      }

      appliedTargets.push({
        strategy,
        url: entry?.requestedUrl || url,
        nodeId: entry?.nodeId,
        score: entry?.score,
        targetHint: entry?.targetHint,
        bookmarkPreload: entry?.bookmarkPreload,
        scoreBreakdown: entry?.scoreBreakdown,
        transitionMetrics: entry?.transitionMetrics,
        aiKeywordMatch: entry?.aiKeywordMatch,
        realPreloadSafety: entry?.realPreloadSafety,
        siteSelection: entry?.siteSelection,
      });
    }
  }

  return buildPreloadSelectionFingerprint(appliedTargets);
}

function buildPreloadSelectionFingerprint(targets) {
  const normalizedTargets = (Array.isArray(targets) ? targets : [])
    .map((target) => {
      const strategy = typeof target?.strategy === "string" ? target.strategy : "";

      return {
        strategy,
        url: typeof target?.url === "string" ? target.url : "",
        nodeId: typeof target?.nodeId === "string" ? target.nodeId : "",
        score: Number.isFinite(Number(target?.score)) ? Number(target.score) : 0,
        targetHint:
          strategy === "prerender" && typeof target?.targetHint === "string"
            ? target.targetHint
            : "",
        metadata: stableStringifyPreloadSelectionValue({
          bookmarkPreload: target?.bookmarkPreload ?? null,
          scoreBreakdown: target?.scoreBreakdown ?? null,
          transitionMetrics: target?.transitionMetrics ?? null,
          aiKeywordMatch: target?.aiKeywordMatch ?? null,
          realPreloadSafety: target?.realPreloadSafety ?? null,
          siteSelection: target?.siteSelection ?? null,
        }),
      };
    })
    .filter((target) => target.strategy && target.url);
  const uniqueTargets = new Map();

  for (const target of normalizedTargets) {
    uniqueTargets.set(`${target.strategy}\n${target.url}`, target);
  }

  const sortedTargets = [...uniqueTargets.values()]
    .sort((left, right) =>
      `${left.strategy}\n${left.url}`.localeCompare(`${right.strategy}\n${right.url}`)
    );

  return JSON.stringify(sortedTargets);
}

function stableStringifyPreloadSelectionValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringifyPreloadSelectionValue).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringifyPreloadSelectionValue(value[key])}`
      )
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}

async function queryOpenNormalTabs() {
  try {
    const tabs = await chrome.tabs.query({
      windowType: "normal",
    });
    const settings =
      typeof getEffectiveExtensionSettings === "function"
        ? getEffectiveExtensionSettings()
        : null;

    return tabs.filter(
      (tab) =>
        globalThis.ZeroLatencyPreloadIncognitoPolicy?.shouldExcludeIncognitoPreloadSource?.(
          tab,
          settings
        ) !== true &&
        globalThis.ZeroLatencyPreloadProxySkipPolicy?.shouldSkipProxyPreloadSource?.(
          tab,
          settings
        ) !== true
    );
  } catch (_error) {
    return [];
  }
}

async function notifyScheduledSourceTabs(scheduledSelections) {
  for (const scheduledSelection of Array.isArray(scheduledSelections)
    ? scheduledSelections
    : []) {
    try {
      await chrome.tabs.sendMessage(scheduledSelection.sourceTabId, {
        type: "preload:apply-speculation-rules",
        prerenderTargets: scheduledSelection.selection.prerenderTargets,
        prefetchTargets: scheduledSelection.selection.prefetchTargets,
      });
    } catch (_error) {
      // The tab may not currently have a live content script.
    }
  }
}

function countSchedulerSelectionTargets(selection) {
  return {
    selected: Array.isArray(selection?.selectedTargets)
      ? selection.selectedTargets.length
      : 0,
    hiddenTab: Array.isArray(selection?.tabTargets) ? selection.tabTargets.length : 0,
    prerender: Array.isArray(selection?.prerenderTargets)
      ? selection.prerenderTargets.length
      : 0,
    prefetch: Array.isArray(selection?.prefetchTargets)
      ? selection.prefetchTargets.length
      : 0,
  };
}

function recordSchedulerRuntimeSyncEvent(eventName, payload = {}) {
  globalThis.ZeroLatencyDebugEvents?.record?.(eventName, payload);
}
