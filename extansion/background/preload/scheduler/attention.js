(function () {
  const DEFAULT_ATTENTION_POOL_DURATION_MS = 5 * 60 * 60 * 1000;
  const DEFAULT_ATTENTION_SEGMENT_DURATION_MS = 60 * 1000;
  const DEFAULT_ATTENTION_MIN_SLICE_MS = 250;
  const DEFAULT_ATTENTION_MAX_OBSERVABLE_GAP_MS = 60 * 1000;
  const DEFAULT_ATTENTION_INPUT_WINDOW_MS = 60 * 1000;
  const DEFAULT_ATTENTION_MEDIA_PLAYBACK_WEIGHT = 0.2;
  const DEFAULT_ATTENTION_AUDIO_PLAYBACK_WEIGHT = 0.07;

  function resolvePreloadAttentionOptions(options = {}) {
    return {
      poolDurationMs: normalizeDurationMs(
        options.poolDurationMs,
        DEFAULT_ATTENTION_POOL_DURATION_MS
      ),
      segmentDurationMs: normalizeDurationMs(
        options.segmentDurationMs,
        DEFAULT_ATTENTION_SEGMENT_DURATION_MS
      ),
      minSliceMs: normalizeDurationMs(
        options.minSliceMs,
        DEFAULT_ATTENTION_MIN_SLICE_MS
      ),
      maxObservableGapMs: normalizeDurationMs(
        options.maxObservableGapMs,
        DEFAULT_ATTENTION_MAX_OBSERVABLE_GAP_MS
      ),
      inputWindowMs: normalizeDurationMs(
        options.inputWindowMs,
        DEFAULT_ATTENTION_INPUT_WINDOW_MS
      ),
      mediaPlaybackWeight: normalizeWeight(
        options.mediaPlaybackWeight,
        DEFAULT_ATTENTION_MEDIA_PLAYBACK_WEIGHT
      ),
      audioPlaybackWeight: normalizeWeight(
        options.audioPlaybackWeight,
        DEFAULT_ATTENTION_AUDIO_PLAYBACK_WEIGHT
      ),
    };
  }

  function appendPreloadAttentionDuration(attentionPool, rawSegment, options = {}) {
    const pool = normalizePreloadAttentionPool(attentionPool);
    const resolvedOptions = resolvePreloadAttentionOptions(options);
    const baseSegment = normalizePreloadAttentionAppendSegment(rawSegment);

    if (!baseSegment) {
      return pool;
    }

    const startedAtMs =
      parseTimestampMs(baseSegment.startedAt) ??
      Math.max(0, baseSegment.endedAtMs - baseSegment.durationMs);
    let remainingDurationMs = baseSegment.durationMs;
    let nextStartedAtMs = startedAtMs;

    while (remainingDurationMs > 0) {
      const durationMs = Math.min(remainingDurationMs, resolvedOptions.segmentDurationMs);
      const endedAtMs = nextStartedAtMs + durationMs;

      pool.segments.push({
        tabId: baseSegment.tabId,
        windowId: baseSegment.windowId,
        pageUrl: baseSegment.pageUrl,
        durationMs,
        startedAt: new Date(nextStartedAtMs).toISOString(),
        endedAt: new Date(endedAtMs).toISOString(),
      });

      pool.totalDurationMs += durationMs;
      remainingDurationMs -= durationMs;
      nextStartedAtMs = endedAtMs;
    }

    pool.updatedAt = new Date(baseSegment.endedAtMs).toISOString();
    return trimPreloadAttentionPool(pool, resolvedOptions.poolDurationMs);
  }

  function recordPreloadAttentionObservation(preloadState, observation, options = {}) {
    const targetState = isPlainObject(preloadState) ? preloadState : createEmptyPreloadState();
    const scheduler = normalizePreloadSchedulerState(targetState.scheduler);
    const resolvedOptions = resolvePreloadAttentionOptions(options);
    const observedAtMs = parseTimestampMs(observation?.observedAt) ?? Date.now();
    const observedAt = new Date(observedAtMs).toISOString();
    const previousCursor = normalizePreloadAttentionCursor(scheduler.activeTabCursor);
    const nextCursor = buildAttentionCursorFromObservation(observation, observedAt);
    const previousObservedAtMs = parseTimestampMs(previousCursor.observedAt);
    const wallElapsedMs =
      previousObservedAtMs === null ? 0 : Math.max(0, observedAtMs - previousObservedAtMs);
    const previousExpiresAtMs = parseTimestampMs(previousCursor.expiresAt);
    const effectiveObservedAtMs =
      previousExpiresAtMs === null ? observedAtMs : Math.min(observedAtMs, previousExpiresAtMs);
    const elapsedMs =
      previousObservedAtMs === null
        ? 0
        : Math.max(0, effectiveObservedAtMs - previousObservedAtMs);
    const previousWeight = normalizeWeight(previousCursor.weight, 0);
    const weightedElapsedMs = elapsedMs * previousWeight;
    const shouldRecordElapsed =
      previousCursor.counting === true &&
      elapsedMs >= resolvedOptions.minSliceMs &&
      wallElapsedMs <= resolvedOptions.maxObservableGapMs &&
      weightedElapsedMs > 0;

    let recordedDurationMs = 0;
    let pendingBeforeMs = 0;
    let pendingAfterMs = 0;
    let committedSegmentCount = 0;

    if (previousCursor.counting === true) {
      pendingBeforeMs = clampNonNegativeNumber(
        getPreloadAttentionPendingEntry(scheduler, previousCursor)?.durationMs,
        0
      );
      pendingAfterMs = pendingBeforeMs;
    }

    if (shouldRecordElapsed) {
      const pendingEntry = getPreloadAttentionPendingEntry(scheduler, previousCursor);
      let pendingDurationMs = pendingBeforeMs;
      const pendingStartedAt =
        pendingEntry?.startedAt ||
        previousCursor.pendingStartedAt ||
        previousCursor.observedAt ||
        observedAt;

      pendingDurationMs += weightedElapsedMs;
      const segmentDurationMs = resolvedOptions.segmentDurationMs;
      const committableDurationMs =
        Math.floor(pendingDurationMs / segmentDurationMs) * segmentDurationMs;

      if (committableDurationMs > 0) {
        pendingDurationMs -= committableDurationMs;
        committedSegmentCount = Math.floor(committableDurationMs / segmentDurationMs);
        const committedEndedAtMs = effectiveObservedAtMs;
        const committedStartedAtMs = Math.max(
          0,
          committedEndedAtMs - committableDurationMs
        );

        scheduler.attentionPool = appendPreloadAttentionDuration(
          scheduler.attentionPool,
          {
            tabId: previousCursor.tabId,
            windowId: previousCursor.windowId,
            pageUrl: previousCursor.pageUrl,
            durationMs: committableDurationMs,
            startedAt: new Date(committedStartedAtMs).toISOString(),
            endedAt: new Date(committedEndedAtMs).toISOString(),
          },
          resolvedOptions
        );
        recordedDurationMs = committableDurationMs;
        recordSchedulerEvent("scheduler.attention.segment-committed", {
          sourceTabId: previousCursor.tabId,
          sourceWindowId: previousCursor.windowId,
          sourcePageUrl: previousCursor.pageUrl,
          durationMs: committableDurationMs,
          segmentDurationMs,
          segmentCount: committedSegmentCount,
          pendingBeforeMs,
          pendingAfterMs: pendingDurationMs,
          poolTotalDurationMs: scheduler.attentionPool.totalDurationMs,
          startedAt: new Date(committedStartedAtMs).toISOString(),
          endedAt: new Date(committedEndedAtMs).toISOString(),
        });
      }

      setPreloadAttentionPendingEntry(
        scheduler,
        previousCursor,
        pendingDurationMs,
        pendingStartedAt,
        observedAt
      );
      pendingAfterMs = pendingDurationMs;
    }

    applyPreloadAttentionPendingToCursor(nextCursor, scheduler);

    scheduler.activeTabCursor = nextCursor;
    scheduler.updatedAt = observedAt;
    targetState.scheduler = scheduler;
    targetState.updatedAt = observedAt;

    const skippedLongGap =
      previousCursor.counting === true &&
      previousObservedAtMs !== null &&
      wallElapsedMs > resolvedOptions.maxObservableGapMs;

    recordSchedulerEvent("scheduler.attention.observation", {
      reason: typeof observation?.reason === "string" ? observation.reason : null,
      observedAt,
      previous: summarizeAttentionCursor(previousCursor),
      next: summarizeAttentionCursor(nextCursor),
      elapsedMs,
      wallElapsedMs,
      weightedElapsedMs,
      previousWeight,
      minSliceMs: resolvedOptions.minSliceMs,
      maxObservableGapMs: resolvedOptions.maxObservableGapMs,
      segmentDurationMs: resolvedOptions.segmentDurationMs,
      shouldRecordElapsed,
      pendingBeforeMs,
      pendingAfterMs,
      recordedDurationMs,
      committedSegmentCount,
      skippedLongGap,
      poolTotalDurationMs: scheduler.attentionPool.totalDurationMs,
    });

    return {
      preloadState: targetState,
      recordedDurationMs,
      skippedLongGap,
    };
  }

  async function recordPreloadAttentionObservationAndMaybeReschedule(
    preloadState,
    observation,
    options = {}
  ) {
    const result = recordPreloadAttentionObservation(preloadState, observation, options);
    result.scheduledSelections = [];

    if (result.recordedDurationMs <= 0) {
      return result;
    }

    const schedulerSelections = globalThis.ZeroLatencyPreloadSchedulerSelections;

    if (typeof schedulerSelections?.rescheduleStoredPreloadSelections !== "function") {
      recordSchedulerEvent("scheduler.attention.reschedule", {
        recordedDurationMs: result.recordedDurationMs,
        skipped: true,
        reason: "rescheduler-unavailable",
      });
      return result;
    }

    const rescheduleResult = await schedulerSelections.rescheduleStoredPreloadSelections(
      result.preloadState,
      {
        settings: globalThis.getEffectiveExtensionSettings?.() ?? null,
      }
    );

    if (rescheduleResult?.preloadState) {
      result.preloadState = rescheduleResult.preloadState;
    }

    result.scheduledSelections = Array.isArray(rescheduleResult?.scheduledSelections)
      ? rescheduleResult.scheduledSelections
      : [];
    recordSchedulerEvent("scheduler.attention.reschedule", {
      recordedDurationMs: result.recordedDurationMs,
      skipped: false,
      scheduledSourceTabCount: result.scheduledSelections.length,
      scheduledSourceTabIds: result.scheduledSelections.map((entry) => entry.sourceTabId),
      mode: "stored-snapshot",
      recomputedCandidateScores: false,
    });
    return result;
  }

  async function notifyAttentionReschedule(result) {
    if (!Array.isArray(result?.scheduledSelections) || result.scheduledSelections.length === 0) {
      return;
    }

    await globalThis.ZeroLatencyPreloadSchedulerSelections?.notifyScheduledSourceTabs?.(
      result.scheduledSelections
    );
  }

  function getPreloadAttentionPendingEntry(scheduler, tabRef) {
    const key = buildPreloadAttentionTabKey(tabRef);

    if (!key || !isPlainObject(scheduler?.attentionPendingByKey)) {
      return null;
    }

    return scheduler.attentionPendingByKey[key] || null;
  }

  function setPreloadAttentionPendingEntry(
    scheduler,
    tabRef,
    durationMs,
    startedAt,
    updatedAt
  ) {
    const key = buildPreloadAttentionTabKey(tabRef);

    if (!key) {
      return;
    }

    if (!isPlainObject(scheduler.attentionPendingByKey)) {
      scheduler.attentionPendingByKey = {};
    }

    const normalizedDurationMs = clampNonNegativeNumber(durationMs, 0);

    if (normalizedDurationMs <= 0) {
      delete scheduler.attentionPendingByKey[key];
      return;
    }

    scheduler.attentionPendingByKey[key] = {
      tabId: normalizePositiveInteger(tabRef?.tabId),
      windowId: normalizePositiveInteger(tabRef?.windowId),
      pageUrl: normalizeAttentionPageUrl(tabRef?.pageUrl || ""),
      durationMs: normalizedDurationMs,
      startedAt: typeof startedAt === "string" ? startedAt : null,
      updatedAt: typeof updatedAt === "string" ? updatedAt : null,
    };
  }

  function applyPreloadAttentionPendingToCursor(cursor, scheduler) {
    cursor.pendingDurationMs = 0;
    cursor.pendingStartedAt = null;

    if (cursor.counting !== true) {
      return cursor;
    }

    const pendingEntry = getPreloadAttentionPendingEntry(scheduler, cursor);

    if (pendingEntry) {
      cursor.pendingDurationMs = clampNonNegativeNumber(pendingEntry.durationMs, 0);
      cursor.pendingStartedAt =
        typeof pendingEntry.startedAt === "string" ? pendingEntry.startedAt : null;
    }

    return cursor;
  }

  function computePreloadAttentionDwellShares(attentionPool, tabRefs) {
    const pool = normalizePreloadAttentionPool(attentionPool);
    const refs = (Array.isArray(tabRefs) ? tabRefs : [])
      .map((tabRef) => ({
        key: buildPreloadAttentionTabKey(tabRef),
        tabId: normalizePositiveInteger(tabRef?.tabId),
      }))
      .filter((tabRef) => tabRef.key);
    const shareByTabId = {};

    if (refs.length === 0) {
      return shareByTabId;
    }

    if (pool.totalDurationMs <= 0) {
      for (const ref of refs) {
        shareByTabId[String(ref.tabId)] = 1;
      }
      return shareByTabId;
    }

    const requestedKeys = new Set(refs.map((ref) => ref.key));
    const durationByKey = {};

    for (const segment of pool.segments) {
      const key = buildPreloadAttentionTabKey(segment);

      if (!requestedKeys.has(key)) {
        continue;
      }

      durationByKey[key] = (durationByKey[key] || 0) + segment.durationMs;
    }

    for (const ref of refs) {
      shareByTabId[String(ref.tabId)] = Math.max(
        0,
        Math.min(1, (durationByKey[ref.key] || 0) / pool.totalDurationMs)
      );
    }

    return shareByTabId;
  }

  async function recordActiveTabAttentionFromActiveInfo(
    activeInfo,
    reason = "tab-activated",
    options = {}
  ) {
    const tabId = normalizePositiveInteger(activeInfo?.tabId);

    if (tabId === null) {
      return;
    }

    const tab = await getTabMaybe(tabId);
    await recordActiveTabAttentionFromTab(tab, reason, options);
  }

  async function recordActiveTabAttentionFromSender(
    sender,
    reason = "content-activity",
    options = {}
  ) {
    const senderTabId = normalizePositiveInteger(sender?.tab?.id);
    const liveTab = senderTabId === null ? null : await getTabMaybe(senderTabId);

    await recordActiveTabAttentionFromTab(
      liveTab
        ? {
            ...liveTab,
            url: sender?.tab?.url || liveTab.url || "",
          }
        : sender?.tab,
      reason,
      options
    );
  }

  async function recordActiveTabAttentionFromNavigationDetails(
    details,
    reason = "navigation",
    options = {}
  ) {
    const tabId = normalizePositiveInteger(details?.tabId);

    if (tabId === null) {
      return;
    }

    const tab = await getTabMaybe(tabId);
    await recordActiveTabAttentionFromTab(
      {
        ...tab,
        url: details?.url || tab?.url || "",
      },
      reason,
      options
    );
  }

  async function recordActiveTabAttentionFromFocusedWindow(
    windowId,
    reason = "window-focus",
    options = {}
  ) {
    const normalizedWindowId = normalizePositiveInteger(windowId);

    if (normalizedWindowId === null) {
      await pausePreloadAttentionCursor(reason, options);
      return;
    }

    let activeTabs = [];

    try {
      activeTabs = await chrome.tabs.query({
        windowId: normalizedWindowId,
        active: true,
      });
    } catch (_error) {
      activeTabs = [];
    }

    await recordActiveTabAttentionFromTab(activeTabs[0] ?? null, reason, options);
  }

  async function pausePreloadAttentionCursor(reason = "pause", options = {}) {
    let result = null;
    const task = async () => {
      const preloadState = await loadPreloadState();
      result = await recordPreloadAttentionObservationAndMaybeReschedule(
        preloadState,
        {
          observedAt: new Date().toISOString(),
          counting: false,
          reason,
        },
        buildPreloadAttentionRuntimeOptions(options)
      );

      await savePreloadState(result.preloadState);
    };

    if (options?.queue === false) {
      await task();
      await notifyAttentionReschedule(result);
      return;
    }

    await queueMutation(task);
    await notifyAttentionReschedule(result);
  }

  async function pausePreloadAttentionCursorIfMatches(
    match,
    reason = "pause-matched",
    options = {}
  ) {
    const tabId = normalizePositiveInteger(match?.tabId);
    const windowId = normalizePositiveInteger(match?.windowId);

    if (tabId === null && windowId === null) {
      return;
    }

    let result = null;
    const task = async () => {
      const preloadState = await loadPreloadState();
      const cursor = normalizePreloadAttentionCursor(
        preloadState?.scheduler?.activeTabCursor
      );
      const tabMatches = tabId === null || cursor.tabId === tabId;
      const windowMatches = windowId === null || cursor.windowId === windowId;

      if (!tabMatches || !windowMatches) {
        return;
      }

      result = await recordPreloadAttentionObservationAndMaybeReschedule(
        preloadState,
        {
          observedAt: new Date().toISOString(),
          counting: false,
          reason,
        },
        buildPreloadAttentionRuntimeOptions(options)
      );

      await savePreloadState(result.preloadState);
    };

    if (options?.queue === false) {
      await task();
      await notifyAttentionReschedule(result);
      return;
    }

    await queueMutation(task);
    await notifyAttentionReschedule(result);
  }

  async function recordActiveTabAttentionFromTab(tab, reason = "active-tab", options = {}) {
    const tabId = normalizePositiveInteger(tab?.id);
    const windowId = normalizePositiveInteger(tab?.windowId);

    if (tabId === null || windowId === null) {
      return;
    }

    const sourceWindow = await getWindowMaybe(windowId);
    const pageUrl = normalizeAttentionPageUrl(tab?.url || "");
    const runtimeOptions = buildPreloadAttentionRuntimeOptions(options);
    const activity = resolveAttentionActivity(options?.activity, runtimeOptions);
    const settings =
      typeof getEffectiveExtensionSettings === "function"
        ? getEffectiveExtensionSettings()
        : null;
    const incognitoExcluded =
      globalThis.ZeroLatencyPreloadIncognitoPolicy?.shouldExcludeIncognitoPreloadSource?.(
        {
          ...tab,
          incognito: tab?.incognito === true || sourceWindow?.incognito === true,
        },
        settings
      ) === true;
    const proxySkipped =
      globalThis.ZeroLatencyPreloadProxySkipPolicy?.shouldSkipProxyPreloadSource?.(
        tab,
        settings
      ) === true;
    const canCount =
      sourceWindow?.type === "normal" &&
      sourceWindow?.focused === true &&
      tab?.active === true &&
      incognitoExcluded !== true &&
      proxySkipped !== true &&
      pageUrl &&
      isTrackableAndAllowedUrl(pageUrl) &&
      activity.weight > 0;

    let result = null;
    const task = async () => {
      const preloadState = await loadPreloadState();

      if (isPreloadTab(preloadState, tabId)) {
        return;
      }

      result = await recordPreloadAttentionObservationAndMaybeReschedule(
        preloadState,
        {
          tabId,
          windowId,
          pageUrl,
          observedAt: new Date().toISOString(),
          counting: canCount,
          weight: canCount ? activity.weight : 0,
          activityKind: canCount ? activity.kind : "inactive",
          expiresAt: canCount ? activity.expiresAt : null,
          reason,
        },
        runtimeOptions
      );

      await savePreloadState(result.preloadState);
    };

    if (options?.queue === false) {
      await task();
      await notifyAttentionReschedule(result);
      return;
    }

    await queueMutation(task);
    await notifyAttentionReschedule(result);
  }

  function trimPreloadAttentionPool(attentionPool, poolDurationMs) {
    const pool = normalizePreloadAttentionPool(attentionPool);
    const maxDurationMs = normalizeDurationMs(poolDurationMs, DEFAULT_ATTENTION_POOL_DURATION_MS);

    while (pool.totalDurationMs > maxDurationMs && pool.segments.length > 0) {
      const overflowMs = pool.totalDurationMs - maxDurationMs;
      const firstSegment = pool.segments[0];

      if (firstSegment.durationMs <= overflowMs) {
        pool.segments.shift();
        pool.totalDurationMs -= firstSegment.durationMs;
        continue;
      }

      firstSegment.durationMs -= overflowMs;
      firstSegment.startedAt = advanceIsoTimestamp(firstSegment.startedAt, overflowMs);
      pool.totalDurationMs -= overflowMs;
    }

    return pool;
  }

  function normalizePreloadAttentionAppendSegment(rawSegment) {
    const tabId = normalizePositiveInteger(rawSegment?.tabId);
    const windowId = normalizePositiveInteger(rawSegment?.windowId);
    const pageUrl = normalizeAttentionPageUrl(rawSegment?.pageUrl || "");
    const durationMs = normalizePositiveFiniteNumber(rawSegment?.durationMs);
    const endedAtMs = parseTimestampMs(rawSegment?.endedAt) ?? Date.now();

    if (tabId === null || windowId === null || !pageUrl || durationMs === null) {
      return null;
    }

    return {
      tabId,
      windowId,
      pageUrl,
      durationMs,
      startedAt: typeof rawSegment?.startedAt === "string" ? rawSegment.startedAt : null,
      endedAtMs,
    };
  }

  function buildAttentionCursorFromObservation(observation, observedAt) {
    const tabId = normalizePositiveInteger(observation?.tabId);
    const windowId = normalizePositiveInteger(observation?.windowId);
    const pageUrl = normalizeAttentionPageUrl(observation?.pageUrl || "");
    const rawWeight = Object.prototype.hasOwnProperty.call(observation || {}, "weight")
      ? observation.weight
      : 1;
    const counting =
      observation?.counting !== false &&
      tabId !== null &&
      windowId !== null &&
      Boolean(pageUrl) &&
      normalizeWeight(rawWeight, 0) > 0;
    const weight = counting ? normalizeWeight(rawWeight, 1) : 0;

    return {
      tabId,
      windowId,
      pageUrl,
      observedAt,
      counting,
      weight,
      activityKind:
        counting && typeof observation?.activityKind === "string"
          ? observation.activityKind
          : "inactive",
      expiresAt:
        counting && typeof observation?.expiresAt === "string"
          ? observation.expiresAt
          : null,
      pendingDurationMs: 0,
      pendingStartedAt: null,
    };
  }

  function summarizeAttentionCursor(cursor) {
    return {
      tabId: cursor?.tabId ?? null,
      windowId: cursor?.windowId ?? null,
      pageUrl: cursor?.pageUrl || "",
      observedAt: cursor?.observedAt || null,
      counting: cursor?.counting === true,
      weight: Number(cursor?.weight) || 0,
      activityKind: cursor?.activityKind || "inactive",
      expiresAt: cursor?.expiresAt || null,
      pendingDurationMs: clampNonNegativeNumber(cursor?.pendingDurationMs, 0),
    };
  }

  function buildPreloadAttentionRuntimeOptions(options = {}) {
    const effectiveSettings =
      globalThis.getEffectiveExtensionSettings?.() ??
      null;
    const schedulerSettings =
      effectiveSettings?.preloading?.effectivePreloadScheduler ??
      effectiveSettings?.preloading?.scheduler ??
      globalThis.ZeroLatencySettings?.DEFAULT_SETTINGS?.preloading?.scheduler ??
      {};

    return {
      poolDurationMs: Number(schedulerSettings.attentionPoolHours) * 60 * 60 * 1000,
      segmentDurationMs: Number(schedulerSettings.attentionSegmentSeconds) * 1000,
      maxObservableGapMs: Number(schedulerSettings.attentionMaxObservableGapSeconds) * 1000,
      inputWindowMs: Number(schedulerSettings.attentionInputWindowSeconds) * 1000,
      mediaPlaybackWeight: Number(schedulerSettings.attentionMediaPlaybackWeight),
      audioPlaybackWeight: Number(schedulerSettings.attentionAudioPlaybackWeight),
      ...options,
    };
  }

  function resolveAttentionActivity(rawActivity, options = {}) {
    const resolvedOptions = resolvePreloadAttentionOptions(options);

    if (!rawActivity || typeof rawActivity !== "object") {
      return {
        kind: "inactive",
        weight: 0,
        expiresAt: null,
      };
    }

    if (rawActivity.documentVisible !== true || rawActivity.prerendering === true) {
      return {
        kind: "hidden",
        weight: 0,
        expiresAt: null,
      };
    }

    const observedAtMs = parseTimestampMs(rawActivity.observedAt) ?? Date.now();
    const lastUserInputAtMs = parseTimestampMs(rawActivity.lastUserInputAt);
    const userInputExpiresAtMs =
      lastUserInputAtMs === null
        ? null
        : lastUserInputAtMs + resolvedOptions.inputWindowMs;
    const hasRecentUserInput =
      userInputExpiresAtMs !== null && observedAtMs <= userInputExpiresAtMs;

    if (hasRecentUserInput) {
      return {
        kind: "user-input",
        weight: 1,
        expiresAt: new Date(userInputExpiresAtMs).toISOString(),
      };
    }

    if (
      (rawActivity.videoPlaybackActive === true ||
        rawActivity.mediaPlaybackKind === "video" ||
        rawActivity.mediaPlaybackActive === true) &&
      resolvedOptions.mediaPlaybackWeight > 0
    ) {
      return {
        kind: "video-playback",
        weight: resolvedOptions.mediaPlaybackWeight,
        expiresAt: null,
      };
    }

    if (
      (rawActivity.audioPlaybackActive === true ||
        rawActivity.mediaPlaybackKind === "audio") &&
      resolvedOptions.audioPlaybackWeight > 0
    ) {
      return {
        kind: "audio-playback",
        weight: resolvedOptions.audioPlaybackWeight,
        expiresAt: null,
      };
    }

    return {
      kind: "inactive",
      weight: 0,
      expiresAt: null,
    };
  }

  function buildPreloadAttentionTabKey(tabRef) {
    const tabId = normalizePositiveInteger(tabRef?.tabId);
    const pageUrl = normalizeAttentionPageUrl(tabRef?.pageUrl || "");

    if (tabId === null || !pageUrl) {
      return "";
    }

    return `${tabId}\n${pageUrl}`;
  }

  function normalizeAttentionPageUrl(rawUrl) {
    const value = typeof rawUrl === "string" ? rawUrl : "";

    if (!value) {
      return "";
    }

    return typeof normalizePageUrlForIndex === "function"
      ? normalizePageUrlForIndex(value)
      : value;
  }

  function normalizeDurationMs(value, fallback) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return fallback;
    }

    return numericValue;
  }

  function normalizeWeight(value, fallback) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return fallback;
    }

    return Math.min(1, Math.max(0, numericValue));
  }

  function parseTimestampMs(value) {
    if (typeof value !== "string") {
      return null;
    }

    const parsedValue = Date.parse(value);
    return Number.isNaN(parsedValue) ? null : parsedValue;
  }

  function advanceIsoTimestamp(timestamp, durationMs) {
    const timestampMs = parseTimestampMs(timestamp);

    if (timestampMs === null) {
      return timestamp;
    }

    return new Date(timestampMs + durationMs).toISOString();
  }

  function recordSchedulerEvent(eventName, payload = {}) {
    globalThis.ZeroLatencyDebugEvents?.record?.(eventName, payload);
  }

  globalThis.ZeroLatencyPreloadSchedulerAttention = {
    DEFAULT_ATTENTION_POOL_DURATION_MS,
    DEFAULT_ATTENTION_SEGMENT_DURATION_MS,
    DEFAULT_ATTENTION_MIN_SLICE_MS,
    DEFAULT_ATTENTION_MAX_OBSERVABLE_GAP_MS,
    DEFAULT_ATTENTION_INPUT_WINDOW_MS,
    DEFAULT_ATTENTION_MEDIA_PLAYBACK_WEIGHT,
    DEFAULT_ATTENTION_AUDIO_PLAYBACK_WEIGHT,
    resolvePreloadAttentionOptions,
    appendPreloadAttentionDuration,
    trimPreloadAttentionPool,
    recordPreloadAttentionObservation,
    computePreloadAttentionDwellShares,
    buildPreloadAttentionTabKey,
    buildPreloadAttentionRuntimeOptions,
    resolveAttentionActivity,
    recordActiveTabAttentionFromActiveInfo,
    recordActiveTabAttentionFromSender,
    recordActiveTabAttentionFromNavigationDetails,
    recordActiveTabAttentionFromFocusedWindow,
    pausePreloadAttentionCursor,
    pausePreloadAttentionCursorIfMatches,
  };
})();
