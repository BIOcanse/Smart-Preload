(function () {
  const TRACKING_CHECKPOINT_DELAY_MS = 1_500;
  const MAX_RECOVERY_JOURNAL_EVENTS = 256;
  const runtimeByBackgroundState = new WeakMap();

  async function initializeTrackingStateCacheForBackgroundState(
    backgroundState,
    state,
    rawManifest,
    rawJournal
  ) {
    const journal = Array.isArray(rawJournal) ? rawJournal.filter(isPlainObject) : [];

    for (const event of journal) {
      applyTrackingEventFallback(state, event);
    }

    let manifest = globalThis.ZeroLatencyTrackingHistoryArchive.normalizeHistoryManifest(
      rawManifest
    );
    manifest = await globalThis.ZeroLatencyTrackingHistoryArchive.appendTransitionMessages({
      chromeStorage: backgroundState.chromeStorage,
      manifestKey: backgroundState.keys.TRACKING_HISTORY_MANIFEST_KEY,
      manifest,
      messages: state.graph.transitionMessages,
    });
    pruneTrackingGraphHistory(state.graph, { deep: true });

    const runtime = {
      state,
      manifest,
      recoveryJournal: [],
      checkpointTimer: null,
      persistenceQueue: Promise.resolve(),
      revision: 0,
      checkpointRevision: 0,
    };
    runtimeByBackgroundState.set(backgroundState, runtime);
    updateTrackingSnapshotCache(backgroundState, state);
    return runtime;
  }

  async function loadTrackingStateForBackgroundState(backgroundState) {
    const cached = runtimeByBackgroundState.get(backgroundState);

    if (cached) {
      return cached.state;
    }

    const stored = await backgroundState.chromeStorage.get({
      [backgroundState.keys.GRAPH_KEY]: createEmptyGraph(),
      [backgroundState.keys.TAB_STATE_KEY]: {},
      [backgroundState.keys.PENDING_SOURCE_KEY]: {},
      [backgroundState.keys.TRACKING_HISTORY_MANIFEST_KEY]:
        globalThis.ZeroLatencyTrackingHistoryArchive.createEmptyHistoryManifest(),
      [backgroundState.keys.TRACKING_EVENT_JOURNAL_KEY]: [],
    });
    const state = {
      graph: normalizeTrackingGraph(stored[backgroundState.keys.GRAPH_KEY]),
      tabState: normalizeTrackingTabStateMap(stored[backgroundState.keys.TAB_STATE_KEY]),
      pendingSources: normalizePendingSourceMap(
        stored[backgroundState.keys.PENDING_SOURCE_KEY]
      ),
    };
    const runtime = await initializeTrackingStateCacheForBackgroundState(
      backgroundState,
      state,
      stored[backgroundState.keys.TRACKING_HISTORY_MANIFEST_KEY],
      stored[backgroundState.keys.TRACKING_EVENT_JOURNAL_KEY]
    );
    await flushTrackingCheckpoint(backgroundState, runtime);
    return runtime.state;
  }

  async function loadTrackingSnapshotForPopupForBackgroundState(backgroundState) {
    return backgroundState.getCachedPopupSnapshot();
  }

  async function saveTrackingStateForBackgroundState(backgroundState, state) {
    let runtime = runtimeByBackgroundState.get(backgroundState);

    if (!runtime) {
      runtime = await initializeTrackingStateCacheForBackgroundState(
        backgroundState,
        state,
        null,
        []
      );
    }

    runtime.state = state;
    runtime.revision += 1;
    updateTrackingSnapshotCache(backgroundState, state);
    const appliedEvents =
      globalThis.ZeroLatencyTrackingMutationJournal?.drainAppliedEvents?.(state) || [];

    const persistence = enqueueTrackingPersistence(runtime, async () => {
      runtime.manifest =
        await globalThis.ZeroLatencyTrackingHistoryArchive.appendTransitionMessages({
          chromeStorage: backgroundState.chromeStorage,
          manifestKey: backgroundState.keys.TRACKING_HISTORY_MANIFEST_KEY,
          manifest: runtime.manifest,
          messages: runtime.state.graph.transitionMessages,
        });
      pruneTrackingGraphHistory(runtime.state.graph);

      if (appliedEvents.length > 0) {
        runtime.recoveryJournal.push(...appliedEvents);
        await backgroundState.chromeStorage.set({
          [backgroundState.keys.TRACKING_EVENT_JOURNAL_KEY]: runtime.recoveryJournal,
        });
      }
    });

    if (appliedEvents.length === 0) {
      await persistence;
      await flushTrackingCheckpoint(backgroundState, runtime);
      return;
    }

    await persistence;

    if (runtime.recoveryJournal.length >= MAX_RECOVERY_JOURNAL_EVENTS) {
      await flushTrackingCheckpoint(backgroundState, runtime);
      return;
    }

    scheduleTrackingCheckpoint(backgroundState, runtime);
  }

  async function loadTrackingStateWithCompleteHistoryForBackgroundState(backgroundState) {
    const state = await loadTrackingStateForBackgroundState(backgroundState);
    const runtime = runtimeByBackgroundState.get(backgroundState);
    await runtime.persistenceQueue;
    const archived =
      await globalThis.ZeroLatencyTrackingHistoryArchive.loadAllTransitionMessages({
        chromeStorage: backgroundState.chromeStorage,
        manifest: runtime.manifest,
      });
    state.graph.transitionMessages =
      globalThis.ZeroLatencyTrackingHistoryArchive.mergeArchivedAndHotMessages(
        archived,
        state.graph.transitionMessages
      );
    return state;
  }

  async function replaceTrackingHistoryArchiveForBackgroundState(backgroundState, state) {
    const runtime = runtimeByBackgroundState.get(backgroundState);

    if (!runtime) {
      throw new Error("Tracking state is not initialized.");
    }

    runtime.state = state;
    runtime.revision += 1;
    await enqueueTrackingPersistence(runtime, async () => {
      runtime.manifest =
        await globalThis.ZeroLatencyTrackingHistoryArchive.replaceTransitionMessages({
          chromeStorage: backgroundState.chromeStorage,
          manifestKey: backgroundState.keys.TRACKING_HISTORY_MANIFEST_KEY,
          manifest: runtime.manifest,
          messages: state.graph.transitionMessages,
        });
      runtime.recoveryJournal = [];
      pruneTrackingGraphHistory(state.graph, { deep: true });
    });
    updateTrackingSnapshotCache(backgroundState, state);
    await flushTrackingCheckpoint(backgroundState, runtime);
  }

  async function flushTrackingStateForBackgroundState(backgroundState) {
    const runtime = runtimeByBackgroundState.get(backgroundState);

    if (runtime) {
      await flushTrackingCheckpoint(backgroundState, runtime);
    }
  }

  function scheduleTrackingCheckpoint(backgroundState, runtime) {
    if (runtime.checkpointTimer !== null) {
      return;
    }

    runtime.checkpointTimer = setTimeout(() => {
      runtime.checkpointTimer = null;
      void flushTrackingCheckpoint(backgroundState, runtime);
    }, TRACKING_CHECKPOINT_DELAY_MS);
  }

  async function flushTrackingCheckpoint(backgroundState, runtime) {
    if (runtime.checkpointTimer !== null) {
      clearTimeout(runtime.checkpointTimer);
      runtime.checkpointTimer = null;
    }

    return enqueueTrackingPersistence(runtime, async () => {
      const checkpointRevision = runtime.revision;
      const checkpointState = cloneTrackingState(runtime.state);
      pruneTrackingGraphHistory(checkpointState.graph, { deep: true });
      const summary = buildTrackingGraphSummary(checkpointState.graph);
      const tabState = normalizeTrackingTabStateMap(checkpointState.tabState);

      await backgroundState.chromeStorage.set({
        [backgroundState.keys.GRAPH_KEY]: checkpointState.graph,
        [backgroundState.keys.GRAPH_SUMMARY_KEY]: summary,
        [backgroundState.keys.TAB_STATE_KEY]: tabState,
        [backgroundState.keys.PENDING_SOURCE_KEY]: normalizePendingSourceMap(
          checkpointState.pendingSources
        ),
        [backgroundState.keys.TRACKING_HISTORY_MANIFEST_KEY]: runtime.manifest,
        [backgroundState.keys.TRACKING_EVENT_JOURNAL_KEY]: [],
      });
      runtime.recoveryJournal = [];
      runtime.checkpointRevision = checkpointRevision;

      if (runtime.revision > checkpointRevision) {
        scheduleTrackingCheckpoint(backgroundState, runtime);
      }
    });
  }

  function enqueueTrackingPersistence(runtime, task) {
    const next = runtime.persistenceQueue.then(task);
    runtime.persistenceQueue = next.catch((error) => {
      console.error("Tracking persistence failed.", error);
    });
    return next;
  }

  function updateTrackingSnapshotCache(backgroundState, state) {
    backgroundState.setCachedTrackingSnapshot({
      summary: buildTrackingGraphSummary(state.graph),
      tabState: state.tabState,
    });
  }

  function pruneTrackingGraphHistory(graph, { deep = false } = {}) {
    graph.version = 14;
    graph.persistenceMode = "incremental-checkpoint-v1";
    graph.transitionMessages = Array.isArray(graph.transitionMessages)
      ? graph.transitionMessages.slice(-MAX_HOT_TRANSITION_MESSAGES)
      : [];

    if (!deep) {
      return;
    }

    trimNestedReferenceArrays(graph.transitionMessageBuckets?.buckets);
    trimNestedReferenceArrays(graph.pageTransitionMessageBuckets?.buckets);
    const minimumSequence = graph.transitionMessages[0]?.sequenceNumber ?? 0;

    for (const [dayKey, references] of Object.entries(graph.transitionMessagesByDay || {})) {
      const nextReferences = Array.isArray(references)
        ? references
            .filter((sequenceNumber) => sequenceNumber >= minimumSequence)
            .slice(-MAX_TRANSITION_REFERENCES_PER_DAY)
        : [];

      if (nextReferences.length > 0) {
        graph.transitionMessagesByDay[dayKey] = nextReferences;
      } else {
        delete graph.transitionMessagesByDay[dayKey];
      }
    }
  }

  function trimNestedReferenceArrays(value) {
    if (Array.isArray(value)) {
      if (value.every((item) => Number.isFinite(Number(item)))) {
        trimTransitionReferences(value, MAX_TRANSITION_REFERENCES_PER_ROUTE);
        return;
      }

      for (const item of value) {
        trimNestedReferenceArrays(item);
      }
      return;
    }

    if (!isPlainObject(value)) {
      return;
    }

    for (const nestedValue of Object.values(value)) {
      trimNestedReferenceArrays(nestedValue);
    }
  }

  function cloneTrackingState(state) {
    if (typeof structuredClone === "function") {
      return structuredClone(state);
    }

    return JSON.parse(JSON.stringify(state));
  }

  globalThis.initializeTrackingStateCacheForBackgroundState =
    initializeTrackingStateCacheForBackgroundState;
  globalThis.loadTrackingStateForBackgroundState = loadTrackingStateForBackgroundState;
  globalThis.loadTrackingSnapshotForPopupForBackgroundState =
    loadTrackingSnapshotForPopupForBackgroundState;
  globalThis.saveTrackingStateForBackgroundState = saveTrackingStateForBackgroundState;
  globalThis.loadTrackingStateWithCompleteHistoryForBackgroundState =
    loadTrackingStateWithCompleteHistoryForBackgroundState;
  globalThis.replaceTrackingHistoryArchiveForBackgroundState =
    replaceTrackingHistoryArchiveForBackgroundState;
  globalThis.flushTrackingStateForBackgroundState = flushTrackingStateForBackgroundState;

  globalThis.loadTrackingStateWithCompleteHistory = () =>
    loadTrackingStateWithCompleteHistoryForBackgroundState(globalThis.backgroundState);
  globalThis.replaceTrackingHistoryArchive = (state) =>
    replaceTrackingHistoryArchiveForBackgroundState(globalThis.backgroundState, state);
  globalThis.flushTrackingState = () =>
    flushTrackingStateForBackgroundState(globalThis.backgroundState);
})();
