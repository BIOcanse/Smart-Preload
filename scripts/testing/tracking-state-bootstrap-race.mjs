// 复现并锁定 bootstrap 与非 mutation 队列并发首次加载 tracking state 的竞态。
//
// 没有 readiness 门时：candidate / attention / ai / lifecycle 队列可与 bootstrap 并发
// 走首次加载，两侧各建一个 runtime，后建的覆盖先建的；先建者的 recoveryJournal 随后被
// bootstrap 的整体写入（含 TRACKING_EVENT_JOURNAL_KEY: []）抹掉。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const trackingPath = path.join(
  repoRoot,
  "extension",
  "background",
  "core",
  "state",
  "storage",
  "tracking.js"
);

function createEmptyGraphStub() {
  return { transitionMessages: [], version: 0 };
}

function buildContext() {
  const context = {
    console,
    structuredClone,
    setTimeout,
    clearTimeout,
    Promise,
    JSON,
    Object,
    Array,
    Number,
    applyTrackingEventFallback(state, event) {
      state.appliedEvents = state.appliedEvents || [];
      state.appliedEvents.push(event);
    },
    createEmptyGraph: createEmptyGraphStub,
    normalizeTrackingGraph: (graph) => graph || createEmptyGraphStub(),
    normalizeTrackingTabStateMap: (value) => value || {},
    normalizePendingSourceMap: (value) => value || {},
    buildTrackingGraphSummary: () => ({}),
    trimTransitionReferences: () => {},
    // 来自 extension/background/tracking/graph/model/schema.js。
    // 本测试只跑 tracking.js，其余全用桩；这些在生产 bundle 里是顶层 const，
    // 这里挂在沙箱全局上 —— 未声明的标识符会顺作用域链解析到全局对象。
    TRACKING_GRAPH_SCHEMA_VERSION: 14,
    buildTrackingGraphNormalizationStamp: () => "test:14",
    MAX_HOT_TRANSITION_MESSAGES: 512,
    MAX_TRANSITION_REFERENCES_PER_ROUTE: 64,
    MAX_TRANSITION_REFERENCES_PER_DAY: 512,
    isPlainObject: (value) =>
      Boolean(value) && typeof value === "object" && !Array.isArray(value),
  };

  context.globalThis = context;
  context.ZeroLatencyTrackingHistoryArchive = {
    normalizeHistoryManifest: (value) => value || { segments: [] },
    createEmptyHistoryManifest: () => ({ segments: [] }),
    async appendTransitionMessages({ manifest }) {
      return manifest || { segments: [] };
    },
    async replaceTransitionMessages({ manifest }) {
      return manifest || { segments: [] };
    },
    async loadAllTransitionMessages() {
      return [];
    },
    mergeArchivedAndHotMessages: (archived, hot) => [...archived, ...hot],
  };

  vm.createContext(context);
  vm.runInContext(readFileSync(trackingPath, "utf8"), context, { filename: trackingPath });
  return context;
}

const KEYS = {
  GRAPH_KEY: "graph",
  TAB_STATE_KEY: "tabState",
  PENDING_SOURCE_KEY: "pendingSources",
  TRACKING_HISTORY_MANIFEST_KEY: "manifest",
  TRACKING_EVENT_JOURNAL_KEY: "journal",
  GRAPH_SUMMARY_KEY: "graphSummary",
};

function createBackgroundState({ readyPromise }) {
  const storageReads = [];
  return {
    keys: KEYS,
    storageReads,
    chromeStorage: {
      async get(defaults) {
        storageReads.push(Object.keys(defaults));
        return { ...defaults };
      },
      async set() {},
    },
    whenReady: readyPromise === undefined ? undefined : () => readyPromise,
    setCachedTrackingSnapshot() {},
    getCachedPopupSnapshot() {
      return {};
    },
  };
}

// 场景 1：bootstrap 先建好 runtime，并发的首次加载必须复用它，不得自己再读存储、再建一个。
{
  const context = buildContext();
  let resolveReady;
  const readyPromise = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const backgroundState = createBackgroundState({ readyPromise });

  // candidate 队列抢在 bootstrap 之前发起首次加载。
  const concurrentLoad = context.globalThis.loadTrackingStateForBackgroundState(backgroundState);

  // bootstrap 直接建 runtime（bootstrap.js:39 就是这样调的），然后放行 ready。
  const bootstrapState = { graph: createEmptyGraphStub(), tabState: {}, pendingSources: {} };
  const bootstrapRuntime =
    await context.globalThis.initializeTrackingStateCacheForBackgroundState(
      backgroundState,
      bootstrapState,
      null,
      []
    );
  resolveReady();

  const loadedState = await concurrentLoad;

  assert.equal(
    loadedState,
    bootstrapRuntime.state,
    "并发首次加载没有复用 bootstrap 建立的 runtime —— 存在第二个 runtime"
  );
  assert.equal(
    backgroundState.storageReads.length,
    0,
    "并发首次加载自己读了存储，说明 readiness 门没有生效"
  );
}

// 场景 2：bootstrap 失败时不得挂死，必须退回自初始化。
{
  const context = buildContext();
  const readyPromise = Promise.reject(new Error("bootstrap failed"));
  readyPromise.catch(() => {});
  const backgroundState = createBackgroundState({ readyPromise });

  const loadedState = await context.globalThis.loadTrackingStateForBackgroundState(backgroundState);

  assert.ok(loadedState, "bootstrap 失败后首次加载没有返回状态");
  assert.equal(
    backgroundState.storageReads.length,
    1,
    "bootstrap 失败后没有退回自初始化"
  );
}

// 场景 3：runtime 已存在时直接命中缓存，不等 ready、不读存储。
{
  const context = buildContext();
  const neverResolves = new Promise(() => {});
  const backgroundState = createBackgroundState({ readyPromise: neverResolves });

  const seededState = { graph: createEmptyGraphStub(), tabState: {}, pendingSources: {} };
  await context.globalThis.initializeTrackingStateCacheForBackgroundState(
    backgroundState,
    seededState,
    null,
    []
  );

  const loadedState = await context.globalThis.loadTrackingStateForBackgroundState(backgroundState);

  assert.equal(loadedState, seededState, "已有 runtime 时没有命中缓存");
  assert.equal(backgroundState.storageReads.length, 0, "已有 runtime 时仍读了存储");
}

// 场景 4：backgroundState 没有 whenReady（旧式 mock）时行为不变。
{
  const context = buildContext();
  const backgroundState = createBackgroundState({ readyPromise: undefined });

  const loadedState = await context.globalThis.loadTrackingStateForBackgroundState(backgroundState);

  assert.ok(loadedState, "缺少 whenReady 时首次加载失败");
  assert.equal(backgroundState.storageReads.length, 1, "缺少 whenReady 时没有自初始化");
}

console.log(JSON.stringify({ ok: true, scenarios: 4 }, null, 2));
