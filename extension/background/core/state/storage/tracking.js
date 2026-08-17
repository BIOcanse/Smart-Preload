(function () {
  const TRACKING_CHECKPOINT_DELAY_MS = 1_500;
  const MAX_RECOVERY_JOURNAL_EVENTS = 256;
  // trimNestedReferenceArrays 的硬上限。当前 bucket schema 只有 3–5 层、约 1406×3 个容器，
  // 这两个值留了充足余量；触顶会记 tracking.trim.truncated，不静默返回。
  const MAX_TRIMMED_REFERENCE_DEPTH = 32;
  const MAX_TRIMMED_REFERENCE_CONTAINERS = 200_000;
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

    // 首次加载必须让 bootstrap 先建好那唯一的 runtime。
    //
    // 没有这道门时，非 mutation 队列（candidate / attention / ai / lifecycle）会和
    // bootstrap 并发走首次加载：两侧都看到空缓存、各自读一份存储、各自建 runtime，
    // 而 initializeTrackingStateCacheForBackgroundState 结尾的 set 让后建的覆盖先建的。
    // 先建的那个 runtime 的 persistenceQueue 和 recoveryJournal 就此成为孤儿，紧接着
    // bootstrap 的整体写入（bootstrap.js:66-75，含 TRACKING_EVENT_JOURNAL_KEY: []）
    // 会用它更早读到的陈旧 graph 覆盖存储，并清空 journal —— 那一路的学习被静默抹掉。
    //
    // 这里吞掉 bootstrap 的失败并退回自初始化，避免把本函数变成新的挂死点：
    // bootstrap 正常时走缓存，bootstrap 失败时行为与加这道门之前一致。
    const readyPromise = backgroundState.whenReady?.();

    if (readyPromise && typeof readyPromise.catch === "function") {
      await readyPromise.catch(() => {});

      const cachedAfterReady = runtimeByBackgroundState.get(backgroundState);

      if (cachedAfterReady) {
        return cachedAfterReady.state;
      }
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
      // 没有 applied events 意味着这次变更无法被 journal 表达（例如
      // lockCurrentTabNavigationSource 直接改 pendingSources），只能靠 checkpoint 落盘。
      //
      // 但「只能靠 checkpoint」不等于「必须同步 checkpoint」。此前这里立即 flush，而
      // flushTrackingCheckpoint 会 structuredClone + 序列化**整张图**，跑在 service
      // worker 唯一的线程上。实测成本随图规模：1000 节点约 11 ms、5000 约 47 ms、
      // 20000 约 190 ms —— 而图按设计无上限增长（docs/internal/invariants.md 第 7 条）。
      // 更要命的是这条路径在**每次链接点击**上（manager.js 的 _self 分支），期间
      // webNavigation.onCommitted 等事件全部堵在 mutation 队列后面。
      //
      // 改为与 journal 路径同样的防抖调度：落盘保证不变，连续点击合并成一次
      // checkpoint。代价是变更的持久化最多延后 TRACKING_CHECKPOINT_DELAY_MS；
      // 这类变更是 pendingSources 这种带 TTL 的临时归因状态，不是用户数据，
      // 且 onSuspend 仍会尝试 flushTrackingState。
      await persistence;
      scheduleTrackingCheckpoint(backgroundState, runtime);
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
    const snapshot = cloneTrackingState(state);
    const archived =
      await globalThis.ZeroLatencyTrackingHistoryArchive.loadAllTransitionMessages({
        chromeStorage: backgroundState.chromeStorage,
        manifest: runtime.manifest,
      });
    snapshot.graph.transitionMessages =
      globalThis.ZeroLatencyTrackingHistoryArchive.mergeArchivedAndHotMessages(
        archived,
        snapshot.graph.transitionMessages
      );
    return snapshot;
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
    graph.version = TRACKING_GRAPH_SCHEMA_VERSION;
    graph.persistenceMode = "incremental-checkpoint-v1";
    // 盖归一化戳。这份数据是本版本亲手整理并落盘的，下次冷启动读回来时
    // normalizeTrackingGraph 可以整体跳过再校验（见 schema.js 的说明）。
    graph.normalizedBy = buildTrackingGraphNormalizationStamp();
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

  // 显式栈遍历，替代此前的自递归。
  //
  // 这条路径跑在**每一次 checkpoint 落盘**上（flushTrackingCheckpoint → pruneTrackingGraphHistory
  // → 这里），递归版没有任何深度或节点上限。当前实际深度受 transitionMessageBuckets 的固定
  // schema 约束（`{ buckets: Array(1406) of {} }`，实测 3–5 层），且历史导入路径会在
  // normalize 时整体重建这两个结构（tracking/graph/model/normalize/graph.js:57-62），
  // 所以外部数据到不了这里 —— 但「当前形状恰好是浅的」不是保证，schema 一变就没人拦得住。
  //
  // 顺序无关：每个引用数组各自独立裁剪。
  function trimNestedReferenceArrays(rootValue) {
    const stack = [{ value: rootValue, depth: 0 }];
    const visited = new Set();
    let visitedCount = 0;

    while (stack.length > 0) {
      const { value, depth } = stack.pop();

      if (Array.isArray(value)) {
        if (value.every((item) => Number.isFinite(Number(item)))) {
          trimTransitionReferences(value, MAX_TRANSITION_REFERENCES_PER_ROUTE);
          continue;
        }
      } else if (!isPlainObject(value)) {
        continue;
      }

      if (visited.has(value)) {
        continue;
      }

      visited.add(value);
      visitedCount += 1;

      if (
        visitedCount > MAX_TRIMMED_REFERENCE_CONTAINERS ||
        depth >= MAX_TRIMMED_REFERENCE_DEPTH
      ) {
        globalThis.ZeroLatencyDebugEvents?.record?.("tracking.trim.truncated", {
          reason: depth >= MAX_TRIMMED_REFERENCE_DEPTH ? "depth-limit" : "container-budget",
          visitedContainers: visitedCount,
          depth,
        });
        return;
      }

      const nestedValues = Array.isArray(value) ? value : Object.values(value);

      for (const nestedValue of nestedValues) {
        stack.push({ value: nestedValue, depth: depth + 1 });
      }
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
