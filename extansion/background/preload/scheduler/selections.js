(function () {
  async function applyPreloadSchedulerCandidateSelection({
    sourceTab,
    sourceTabId,
    sourcePageUrl,
    currentNodeId,
    message,
    selection,
    scoredCandidatePool,
    settings,
    graph,
  }) {
    const snapshotSelection =
      selection ??
      (await buildWideSelectionForSnapshot({
        sourceTab,
        sourceTabId,
        sourcePageUrl,
        currentNodeId,
        message,
        scoredCandidatePool,
        settings,
        graph,
      }));
    const sourceSnapshot = buildPreloadCandidateSelectionSnapshot({
      sourceTab,
      sourceTabId,
      sourcePageUrl,
      currentNodeId,
      message,
      selection: snapshotSelection,
      scoredCandidatePool,
      settings,
    });

    if (!sourceSnapshot) {
      return selection;
    }

    let currentSourceSelection = selection;
    const notifications = [];

    await queueMutation(async () => {
      let preloadState = await loadPreloadState();
      const openTabs = await queryOpenNormalTabs();

      preloadState.scheduler = normalizePreloadSchedulerState(preloadState.scheduler);
      rememberPreloadCandidateSelectionSnapshot(preloadState, sourceSnapshot);
      prunePreloadCandidateSelectionSnapshots(preloadState, openTabs);

      const snapshots = Object.values(
        preloadState.scheduler.candidateSelectionSnapshotsByTabId || {}
      );
      const scheduledSelections = await schedulePreloadCandidateSelectionSnapshots({
        snapshots,
        preloadState,
        settings,
        graph,
      });

      for (const scheduledSelection of scheduledSelections) {
        preloadState = await synchronizeScheduledPreloadSelection(
          preloadState,
          scheduledSelection
        );
        notifications.push(scheduledSelection);

        if (Number(scheduledSelection.sourceTabId) === Number(sourceSnapshot.sourceTabId)) {
          currentSourceSelection = scheduledSelection.selection;
        }
      }

      await savePreloadState(preloadState);
    });

    await notifyScheduledSourceTabs(notifications);
    return currentSourceSelection;
  }

  async function buildWideSelectionForSnapshot({
    sourceTab,
    sourceTabId,
    sourcePageUrl,
    currentNodeId,
    message,
    scoredCandidatePool,
    settings,
    graph,
  }) {
    if (
      typeof selectPreloadTargetsFromScoredCandidatePool !== "function" ||
      !Array.isArray(scoredCandidatePool)
    ) {
      return null;
    }

    try {
      return await selectPreloadTargetsFromScoredCandidatePool({
        scoredCandidatePool,
        sourceUrl: sourcePageUrl || sourceTab?.url || "",
        sourceWindowId: sourceTab?.windowId,
        sourceTabId,
        currentPageTitle:
          typeof message?.pageTitle === "string" ? message.pageTitle : sourceTab?.title || "",
        currentPageTextDigest:
          typeof message?.pageTextDigest === "string" ? message.pageTextDigest : "",
        currentPageContentFingerprint:
          typeof message?.contentFingerprint === "string" ? message.contentFingerprint : "",
        graph,
        settings,
        slotLimits: buildSchedulerDiscoverySlotLimits(settings),
      });
    } catch (error) {
      console.warn("Failed to build wide scheduler snapshot selection.", error);
      return null;
    }
  }

  async function rescheduleStoredPreloadSelections(preloadState, options = {}) {
    let nextPreloadState = isPlainObject(preloadState)
      ? preloadState
      : createEmptyPreloadState();
    const settings =
      options?.settings ??
      (typeof getEffectiveExtensionSettings === "function"
        ? getEffectiveExtensionSettings()
        : null);
    const openTabs = await queryOpenNormalTabs();

    nextPreloadState.scheduler = normalizePreloadSchedulerState(nextPreloadState.scheduler);
    recordSchedulerEvent("scheduler.reschedule.stored.start", {
      reason: typeof options?.reason === "string" ? options.reason : "attention-pool-commit",
      snapshotCount: Object.keys(
        nextPreloadState.scheduler.candidateSelectionSnapshotsByTabId || {}
      ).length,
      attentionPoolTotalDurationMs:
        nextPreloadState.scheduler.attentionPool?.totalDurationMs ?? 0,
    });
    prunePreloadCandidateSelectionSnapshots(nextPreloadState, openTabs);

    const snapshots = Object.values(
      nextPreloadState.scheduler.candidateSelectionSnapshotsByTabId || {}
    );
    const scheduledSelections = await schedulePreloadCandidateSelectionSnapshots({
      snapshots,
      preloadState: nextPreloadState,
      settings,
      graph: null,
    });

    for (const scheduledSelection of scheduledSelections) {
      nextPreloadState = await synchronizeScheduledPreloadSelection(
        nextPreloadState,
        scheduledSelection
      );
    }

    recordSchedulerEvent("scheduler.reschedule.stored.finish", {
      reason: typeof options?.reason === "string" ? options.reason : "attention-pool-commit",
      snapshotCount: snapshots.length,
      scheduledSourceTabCount: scheduledSelections.length,
      scheduledSourceTabIds: scheduledSelections.map((entry) => entry.sourceTabId),
      recomputedCandidateScores: false,
    });

    return {
      preloadState: nextPreloadState,
      scheduledSelections,
    };
  }

  function buildSchedulerDiscoverySlotLimits(settings) {
    const schedulerSettings = getEffectiveSchedulerSettings(settings);

    return {
      nativePageSlotLimit: schedulerSettings.nativeTotalMax,
      tabPageSlotLimit: schedulerSettings.tabTotalMax,
    };
  }

  async function schedulePreloadCandidateSelectionSnapshots({
    snapshots,
    preloadState,
    settings,
    graph,
  }) {
    const normalizedSnapshots = (Array.isArray(snapshots) ? snapshots : [])
      .map((snapshot) => normalizePreloadCandidateSelectionSnapshot(snapshot))
      .filter(Boolean);

    recordSchedulerEvent("scheduler.schedule.start", {
      mode: graph ? "candidate-rebuild" : "stored-snapshot",
      snapshotCount: normalizedSnapshots.length,
      attentionPoolTotalDurationMs: preloadState?.scheduler?.attentionPool?.totalDurationMs ?? 0,
      snapshots: normalizedSnapshots.map((snapshot) => ({
        sourceTabId: snapshot.sourceTabId,
        sourceWindowId: snapshot.sourceWindowId,
        sourcePageUrl: snapshot.sourcePageUrl,
        scoreSignals: summarizeScoreSignals(snapshot.scoreSignals),
        selectedCounts: countTargetsByStrategy(snapshot.selectedTargets),
      })),
    });

    if (normalizedSnapshots.length === 0) {
      return [];
    }

    const schedulerSettings = getEffectiveSchedulerSettings(settings);
    const dwellShares =
      globalThis.ZeroLatencyPreloadSchedulerAttention.computePreloadAttentionDwellShares(
        preloadState?.scheduler?.attentionPool,
        normalizedSnapshots.map((snapshot) => ({
          tabId: snapshot.sourceTabId,
          pageUrl: snapshot.sourcePageUrl,
        }))
      );
    const nativeAllocations = allocateSchedulerGroupSlots({
      snapshots: normalizedSnapshots,
      settings: schedulerSettings,
      group: "native",
      dwellShares,
      preloadState,
    });
    const tabAllocations = allocateSchedulerGroupSlots({
      snapshots: normalizedSnapshots,
      settings: schedulerSettings,
      group: "tab",
      dwellShares,
      preloadState,
    });

    return Promise.all(normalizedSnapshots.map(async (snapshot) => {
      const sourceTabId = String(snapshot.sourceTabId);
      const nativeSlots = nativeAllocations.get(sourceTabId) ?? 0;
      const tabSlots = tabAllocations.get(sourceTabId) ?? 0;
      const fallbackSelection = buildLimitedSelectionFromSnapshot(snapshot, {
        nativeSlots,
        tabSlots,
      });
      const selection = await buildScheduledSelectionForSnapshot(snapshot, {
        nativeSlots,
        tabSlots,
        fallbackSelection,
        graph,
        settings,
      });
      recordSchedulerEvent("scheduler.selection.result", {
        mode: graph ? "candidate-rebuild" : "stored-snapshot",
        sourceTabId: snapshot.sourceTabId,
        sourceWindowId: snapshot.sourceWindowId,
        sourcePageUrl: snapshot.sourcePageUrl,
        nativeSlots,
        tabSlots,
        selectedCounts: countSelectionTargets(selection),
        selectedTargets: summarizeSelectionTargets(selection.selectedTargets),
      });

      return {
        sourceTabId: snapshot.sourceTabId,
        sourceWindowId: snapshot.sourceWindowId,
        sourcePageUrl: snapshot.sourcePageUrl,
        nativeSlots,
        tabSlots,
        selection,
      };
    }));
  }

  function allocateSchedulerGroupSlots({
    snapshots,
    settings,
    group,
    dwellShares,
    preloadState,
  }) {
    const totalCap = resolveSchedulerGroupTotalCap(settings, group, snapshots.length);
    const allocationInputs = snapshots
      .map((snapshot, index) => {
        const scoreSignal = getSnapshotScoreSignalForGroup(snapshot, group);
        const dwellShare = resolveSnapshotDwellShare(snapshot, dwellShares, preloadState);
        const linkValueMultiplier = resolveSnapshotLinkValueMultiplier(scoreSignal);
        const finalScore =
          scoreSignal.candidateCount > 0 && dwellShare > 0
            ? linkValueMultiplier * dwellShare
            : 0;

        return {
          tabId: snapshot.sourceTabId,
          sourceWindowId: snapshot.sourceWindowId,
          sourcePageUrl: snapshot.sourcePageUrl,
          score: finalScore,
          scoreSum: scoreSignal.scoreSum,
          linkValueMultiplier,
          dwellShare,
          cap: scoreSignal.candidateCount,
          active: isActiveAttentionCursorSnapshot(snapshot, preloadState),
          lastActiveAt: getSnapshotLastActiveAt(snapshot, preloadState),
          order: index,
        };
      })
      .filter((input) => input.cap > 0);
    const allocations =
      globalThis.ZeroLatencyPreloadSchedulerAllocation.allocateTabPreloadSlots({
        totalCap,
        tabs: allocationInputs,
      });

    recordSchedulerEvent("scheduler.allocation.group", {
      group,
      totalCap,
      inputCount: allocationInputs.length,
      inputs: allocationInputs.map((input) => ({
        tabId: input.tabId,
        sourceWindowId: input.sourceWindowId,
        sourcePageUrl: input.sourcePageUrl,
        candidateCount: input.cap,
        scoreSum: input.scoreSum,
        linkValueMultiplier: input.linkValueMultiplier,
        dwellShare: input.dwellShare,
        finalScore: input.score,
        active: input.active,
        lastActiveAt: input.lastActiveAt,
      })),
      allocations: allocations.map((allocation) => ({
        tabId: allocation.tabId,
        score: allocation.score,
        cap: allocation.cap,
        rawSlots: allocation.rawSlots,
        slots: allocation.slots,
      })),
    });

    return new Map(
      allocations.map((allocation) => [String(allocation.tabId), allocation.slots])
    );
  }

  function resolveSnapshotLinkValueMultiplier(scoreSignal) {
    const storedMultiplier = Number(scoreSignal?.linkValueMultiplier);

    if (Number.isFinite(storedMultiplier) && storedMultiplier > 0) {
      return storedMultiplier;
    }

    return buildSchedulerLinkValueMultiplier(scoreSignal?.scoreSum);
  }

  function resolveSchedulerGroupTotalCap(settings, group, tabCount) {
    const prefix = group === "tab" ? "tab" : "native";

    return globalThis.ZeroLatencyPreloadSchedulerAllocation.resolveAsymptoticPreloadCap({
      tabCount,
      minCap: settings[`${prefix}TotalMin`],
      maxCap: settings[`${prefix}TotalMax`],
      halfLifeTabs: settings[`${prefix}HalfLifeTabs`],
    });
  }

  function buildLimitedSelectionFromSnapshot(snapshot, limits) {
    const selectedTargets = [];
    const nativeTargets = getSnapshotTargetsForGroup(snapshot, "native").slice(
      0,
      limits.nativeSlots
    );
    const tabTargets = getSnapshotTargetsForGroup(snapshot, "tab").slice(0, limits.tabSlots);

    selectedTargets.push(...nativeTargets, ...tabTargets);
    selectedTargets.sort(compareStoredSelectionTargetPriority);

    return buildSelectionFromTargets(selectedTargets);
  }

  async function buildScheduledSelectionForSnapshot(snapshot, context) {
    const nativeSlots = Math.max(0, Math.trunc(Number(context?.nativeSlots) || 0));
    const tabSlots = Math.max(0, Math.trunc(Number(context?.tabSlots) || 0));

    if (nativeSlots <= 0 && tabSlots <= 0) {
      return buildSelectionFromTargets([]);
    }

    if (
      !context?.graph ||
      typeof selectPreloadTargets !== "function" ||
      !Array.isArray(snapshot?.candidateLinks)
    ) {
      return context?.fallbackSelection ?? buildLimitedSelectionFromSnapshot(snapshot, {
        nativeSlots,
        tabSlots,
      });
    }

    try {
      return await selectPreloadTargets({
        currentNodeId: snapshot.currentNodeId || buildNodeSeed(snapshot.sourcePageUrl).nodeId,
        sourceUrl: snapshot.sourcePageUrl,
        sourceWindowId: snapshot.sourceWindowId,
        sourceTabId: snapshot.sourceTabId,
        currentPageTitle: snapshot.currentPageTitle || "",
        currentPageTextDigest: snapshot.currentPageTextDigest || "",
        currentPageContentFingerprint: snapshot.currentPageContentFingerprint || "",
        candidateLinks: snapshot.candidateLinks,
        graph: context.graph,
        settings: context.settings,
        slotLimits: {
          nativePageSlotLimit: nativeSlots,
          tabPageSlotLimit: tabSlots,
        },
      });
    } catch (error) {
      console.warn("Failed to rebuild scheduled preload selection.", error);
      return context?.fallbackSelection ?? buildLimitedSelectionFromSnapshot(snapshot, {
        nativeSlots,
        tabSlots,
      });
    }
  }

  async function synchronizeScheduledPreloadSelection(preloadState, scheduledSelection) {
    recordSchedulerEvent("scheduler.sync.source", {
      sourceTabId: scheduledSelection.sourceTabId,
      sourceWindowId: scheduledSelection.sourceWindowId,
      sourcePageUrl: scheduledSelection.sourcePageUrl,
      nativeSlots: scheduledSelection.nativeSlots,
      tabSlots: scheduledSelection.tabSlots,
      selectedCounts: countSelectionTargets(scheduledSelection.selection),
    });
    let nextPreloadState = await synchronizePreloadsForSourceTab(
      preloadState,
      scheduledSelection.sourceWindowId,
      scheduledSelection.sourceTabId,
      scheduledSelection.selection.tabTargets
    );
    nextPreloadState = synchronizePrerenderEntriesForSourceTab(
      nextPreloadState,
      scheduledSelection.sourceWindowId,
      scheduledSelection.sourceTabId,
      scheduledSelection.selection.selectedTargets.filter(
        (target) => target.strategy === "prerender"
      )
    );
    nextPreloadState = synchronizePrefetchEntriesForSourceTab(
      nextPreloadState,
      scheduledSelection.sourceWindowId,
      scheduledSelection.sourceTabId,
      scheduledSelection.selection.selectedTargets.filter(
        (target) => target.strategy === "prefetch"
      )
    );
    return nextPreloadState;
  }

  function rememberPreloadCandidateSelectionSnapshot(preloadState, snapshot) {
    preloadState.scheduler = normalizePreloadSchedulerState(preloadState.scheduler);
    preloadState.scheduler.candidateSelectionSnapshotsByTabId[
      String(snapshot.sourceTabId)
    ] = snapshot;
    preloadState.scheduler.updatedAt = snapshot.updatedAt;
    preloadState.updatedAt = snapshot.updatedAt;
    recordSchedulerEvent("scheduler.snapshot.remember", {
      sourceTabId: snapshot.sourceTabId,
      sourceWindowId: snapshot.sourceWindowId,
      sourcePageUrl: snapshot.sourcePageUrl,
      updatedAt: snapshot.updatedAt,
      scoreSignals: summarizeScoreSignals(snapshot.scoreSignals),
      selectedCounts: countTargetsByStrategy(snapshot.selectedTargets),
    });
  }

  function prunePreloadCandidateSelectionSnapshots(preloadState, openTabs) {
    const openTabById = new Map(
      (Array.isArray(openTabs) ? openTabs : [])
        .filter((tab) => normalizePositiveInteger(tab?.id) !== null)
        .map((tab) => [String(tab.id), tab])
    );
    const snapshots = preloadState.scheduler?.candidateSelectionSnapshotsByTabId || {};

    for (const [sourceTabId, snapshot] of Object.entries(snapshots)) {
      const openTab = openTabById.get(sourceTabId);
      const currentPageUrl = normalizePageUrlForIndex(openTab?.url || "");

      if (!openTab || currentPageUrl !== snapshot.sourcePageUrl) {
        recordSchedulerEvent("scheduler.snapshot.prune", {
          sourceTabId: snapshot.sourceTabId,
          sourceWindowId: snapshot.sourceWindowId,
          sourcePageUrl: snapshot.sourcePageUrl,
          currentPageUrl,
          reason: !openTab ? "tab-closed" : "page-url-changed",
        });
        delete snapshots[sourceTabId];
      }
    }
  }

  function buildPreloadCandidateSelectionSnapshot({
    sourceTab,
    sourceTabId,
    sourcePageUrl,
    currentNodeId,
    message,
    selection,
    scoredCandidatePool,
    settings,
  }) {
    const normalizedSourceTabId = normalizePositiveInteger(sourceTabId ?? sourceTab?.id);
    const normalizedSourceWindowId = normalizePositiveInteger(sourceTab?.windowId);
    const normalizedSourcePageUrl = normalizePageUrlForIndex(sourcePageUrl || sourceTab?.url || "");

    if (
      normalizedSourceTabId === null ||
      normalizedSourceWindowId === null ||
      !normalizedSourcePageUrl
    ) {
      return null;
    }

    return normalizePreloadCandidateSelectionSnapshot({
      sourceTabId: normalizedSourceTabId,
      sourceWindowId: normalizedSourceWindowId,
      sourcePageUrl: normalizedSourcePageUrl,
      currentNodeId: typeof currentNodeId === "string" ? currentNodeId : "",
      currentPageTitle:
        typeof message?.pageTitle === "string" ? message.pageTitle : sourceTab?.title || "",
      currentPageTextDigest:
        typeof message?.pageTextDigest === "string" ? message.pageTextDigest : "",
      currentPageContentFingerprint:
        typeof message?.contentFingerprint === "string" ? message.contentFingerprint : "",
      scoreSignals: buildSnapshotScoreSignals(scoredCandidatePool, settings),
      candidateLinks: Array.isArray(message?.links) ? message.links : [],
      updatedAt: new Date().toISOString(),
      selectedTargets: selection?.selectedTargets ?? [],
    });
  }

  function buildSelectionFromTargets(targets) {
    const selectedTargets = (Array.isArray(targets) ? targets : [])
      .map(normalizePreloadCandidateSelectionTarget)
      .filter(Boolean)
      .sort(compareStoredSelectionTargetPriority);

    return {
      selectedTargets,
      prerenderTargets: selectedTargets
        .filter((target) => target.strategy === "prerender")
        .map((target) => ({
          url: target.url,
          targetHint: target.targetHint,
        })),
      prefetchTargets: selectedTargets
        .filter((target) => target.strategy === "prefetch")
        .map((target) => ({
          url: target.url,
        })),
      tabTargets: selectedTargets
        .filter((target) => target.strategy === "hidden-tab")
        .map((target) => ({
          url: target.url,
          nodeId: target.nodeId,
          score: target.score,
          scoreBreakdown: target.scoreBreakdown ?? null,
          transitionMetrics: target.transitionMetrics ?? null,
          targetHint: target.targetHint,
          aiKeywordMatch: target.aiKeywordMatch ?? null,
          bookmarkPreload: target.bookmarkPreload ?? null,
          siteSelection: target.siteSelection ?? null,
        })),
    };
  }

  function getSnapshotTargetsForGroup(snapshot, group) {
    const targets = Array.isArray(snapshot?.selectedTargets) ? snapshot.selectedTargets : [];

    return targets
      .filter((target) =>
        group === "tab" ? target.strategy === "hidden-tab" : target.strategy !== "hidden-tab"
      )
      .sort(compareStoredSelectionTargetPriority);
  }

  function getSnapshotScoreSignalForGroup(snapshot, group) {
    const scoreSignals = normalizePreloadSchedulerScoreSignals(snapshot?.scoreSignals);
    const signal = group === "tab" ? scoreSignals.tab : scoreSignals.native;

    if (signal.candidateCount > 0) {
      return signal;
    }

    const targets = getSnapshotTargetsForGroup(snapshot, group);

    return {
      scoreSum: sumSelectionTargetScores(targets),
      candidateCount: targets.length,
    };
  }

  function buildSnapshotScoreSignals(scoredCandidatePool, settings) {
    if (typeof buildPreloadSchedulerScoreSignals !== "function") {
      return normalizePreloadSchedulerScoreSignals(null);
    }

    return normalizePreloadSchedulerScoreSignals(
      buildPreloadSchedulerScoreSignals(scoredCandidatePool, settings)
    );
  }

  function sumSelectionTargetScores(targets) {
    return (Array.isArray(targets) ? targets : []).reduce((sum, target) => {
      const score = Number(target?.score);
      return sum + buildSchedulerLinkScoreSignal(score);
    }, 0);
  }

  function buildSchedulerLinkScoreSignal(score) {
    const normalizedScore = Number(score);

    if (!Number.isFinite(normalizedScore) || normalizedScore <= 0) {
      return 0;
    }

    return normalizedScore ** 1.5;
  }

  function summarizeScoreSignals(scoreSignals) {
    const signals = normalizePreloadSchedulerScoreSignals(scoreSignals);

    return {
      native: summarizeScoreSignal(signals.native),
      tab: summarizeScoreSignal(signals.tab),
    };
  }

  function summarizeScoreSignal(signal) {
    const linkValueMultiplier = resolveSnapshotLinkValueMultiplier(signal);

    return {
      candidateCount: signal.candidateCount,
      scoreSum: signal.scoreSum,
      linkValueMultiplier,
    };
  }

  function countTargetsByStrategy(targets) {
    const counts = {
      selected: 0,
      hiddenTab: 0,
      prerender: 0,
      prefetch: 0,
    };

    for (const target of Array.isArray(targets) ? targets : []) {
      counts.selected += 1;

      if (target?.strategy === "hidden-tab") {
        counts.hiddenTab += 1;
      } else if (target?.strategy === "prerender") {
        counts.prerender += 1;
      } else if (target?.strategy === "prefetch") {
        counts.prefetch += 1;
      }
    }

    return counts;
  }

  function countSelectionTargets(selection) {
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

  function summarizeSelectionTargets(targets) {
    return (Array.isArray(targets) ? targets : []).slice(0, 12).map((target, index) => ({
      rank: index + 1,
      url: target.url,
      strategy: target.strategy,
      score: target.score,
    }));
  }

  function resolveSnapshotDwellShare(snapshot, dwellShares, preloadState) {
    const sourceTabId = String(snapshot.sourceTabId);
    const dwellShare = Number(dwellShares?.[sourceTabId]);

    if (Number.isFinite(dwellShare) && dwellShare > 0) {
      return Math.min(1, dwellShare);
    }

    if (isActiveAttentionCursorSnapshot(snapshot, preloadState)) {
      return 1;
    }

    return Number.isFinite(dwellShare) ? Math.max(0, dwellShare) : 1;
  }

  function isActiveAttentionCursorSnapshot(snapshot, preloadState) {
    const cursor = normalizePreloadAttentionCursor(
      preloadState?.scheduler?.activeTabCursor
    );

    return (
      cursor.counting === true &&
      Number(cursor.tabId) === Number(snapshot.sourceTabId) &&
      cursor.pageUrl === snapshot.sourcePageUrl
    );
  }

  function getSnapshotLastActiveAt(snapshot, preloadState) {
    return isActiveAttentionCursorSnapshot(snapshot, preloadState)
      ? preloadState?.scheduler?.activeTabCursor?.observedAt
      : snapshot.updatedAt;
  }

  function compareStoredSelectionTargetPriority(left, right) {
    const scoreDelta = (Number(right?.score) || 0) - (Number(left?.score) || 0);

    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    const leftUrl = String(left?.url || "");
    const rightUrl = String(right?.url || "");
    return leftUrl.localeCompare(rightUrl);
  }

  function getEffectiveSchedulerSettings(settings) {
    const schedulerSettings =
      settings?.preloading?.effectivePreloadScheduler ??
      settings?.preloading?.scheduler ??
      settingsApi.DEFAULT_SETTINGS.preloading.scheduler;

    return {
      ...settingsApi.DEFAULT_SETTINGS.preloading.scheduler,
      ...(schedulerSettings || {}),
    };
  }

  async function queryOpenNormalTabs() {
    try {
      return await chrome.tabs.query({
        windowType: "normal",
      });
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

  function recordSchedulerEvent(eventName, payload = {}) {
    globalThis.ZeroLatencyDebugEvents?.record?.(eventName, payload);
  }

  globalThis.ZeroLatencyPreloadSchedulerSelections = {
    applyPreloadSchedulerCandidateSelection,
    rescheduleStoredPreloadSelections,
    buildSchedulerDiscoverySlotLimits,
    schedulePreloadCandidateSelectionSnapshots,
    buildSelectionFromTargets,
    notifyScheduledSourceTabs,
  };
})();
