// 候选扫描的积压必须有上限，且已分离的 anchor 条目必须被清理。
//
// H9：生产者 enqueueCandidateMutations 无条件执行，消费者 scheduleCandidateScan 在有可编辑
// 元素聚焦时直接 return（focusin 还会清掉全部定时器却不清空队列）。队列里持有的是**强 DOM
// 引用**，包含 mutation.removedNodes 捕获的已分离节点 —— 在 Gmail 写信、Google Docs 编辑的
// 整个会话里积压单调增长。两个 batch 常量（80/32）限的是每批工作量，不是积压。
//
// M14：candidateAnchorEntries 是以 anchor 元素为 key 的**强** Map，唯一的清理路径在
// collectCandidateLinks 里，而它收满 MAX_CANDIDATE_LINKS 就 break。Map 按插入序迭代，
// 于是每次都只检查同样的前若干条，排在后面的已分离 anchor 永远等不到 isConnected 检查。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const sources = await Promise.all(
  [
    "../../extension/scripts/navigation/shared.js",
    "../../extension/scripts/navigation/candidate-scan/links.js",
  ].map((filePath) => readFile(new URL(filePath, import.meta.url), "utf8"))
);

let anchorSequence = 0;

const documentElement = makeTraversalRoot([]);
const sandbox = {
  URL,
  console: { ...console, debug: () => {} },
  location: { href: "https://source.example/start" },
  document: {
    title: "Backlog fixture",
    readyState: "complete",
    prerendering: false,
    activeElement: null,
    documentElement,
  },
  window: {
    innerWidth: 1280,
    innerHeight: 800,
    setTimeout,
    clearTimeout,
    getComputedStyle: () => ({ display: "inline", visibility: "visible" }),
  },
  IntersectionObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
};
sandbox.globalThis = sandbox;

const context = vm.createContext(sandbox);
vm.runInContext(sources[0], context, { filename: "navigation/shared.js" });
Object.assign(context.ZeroLatencyNavigationContent, {
  normalizeShortText: (value) => String(value || "").trim().slice(0, 240),
  normalizeLongText: (value) => String(value || "").replace(/\s+/g, " ").trim(),
  normalizeNavigableHref(value) {
    try {
      return new URL(String(value || ""), context.location.href).href;
    } catch (_error) {
      return null;
    }
  },
  getAnchorNavigationTarget: () => "_self",
  resolveManagedNavigationTarget: (_sourceUrl, targetUrl) => (targetUrl ? "_self" : null),
  isGoogleSearchInternalModeNavigation: () => false,
  collectAnchorPreloadSafety: () => ({}),
  inspectAnchorSideEffectPreloadSafety: () => ({ skipPreload: false, preloadSafety: {} }),
  shouldSkipSensitivePagePreload: () => false,
});
vm.runInContext(sources[1], context, { filename: "candidate-scan/links.js" });

const navigation = context.ZeroLatencyNavigationContent;
const { state, constants } = navigation;

// --- 1. 消费者停摆时积压必须有上限 ---
//
// 直接不调用 processCandidateMutationWorkBatch，等价于「可编辑元素持续聚焦」这个场景。
{
  const detachedNodes = [];

  // 远超上限的变更量：模拟一次长时间编辑会话。
  for (let round = 0; round < constants.MAX_CANDIDATE_MUTATION_QUEUE * 3; round += 1) {
    const removed = makeAnchor(`https://removed.example/${round}`, { isConnected: false });
    detachedNodes.push(removed);
    navigation.enqueueCandidateMutations([
      {
        type: "childList",
        target: documentElement,
        addedNodes: [],
        removedNodes: [removed],
      },
    ]);
  }

  assert.ok(
    state.candidateMutationWorkQueue.length <= constants.MAX_CANDIDATE_MUTATION_QUEUE,
    `积压达到 ${state.candidateMutationWorkQueue.length} —— 超过上限 ` +
      `${constants.MAX_CANDIDATE_MUTATION_QUEUE}，已分离 DOM 会被无限期钉住`
  );
  assert.equal(
    state.candidateFullReindexPending,
    true,
    "积压触顶后没有标记待全量重建 —— 增量记录被丢了却没人补"
  );
  assert.equal(
    state.candidateMutationWorkQueue.length,
    0,
    "触顶后应当丢弃积压（强 DOM 引用必须立刻释放），而不是停在上限处继续持有"
  );
  assert.equal(state.candidateDirtyAnchors.size, 0, "触顶后脏 anchor 集合也应当清空");
}

// --- 2. 触顶后的全量重建必须恢复到正确状态 ---
{
  const liveAnchors = Array.from({ length: 12 }, (_, index) =>
    makeAnchor(`https://live.example/page-${index}`)
  );
  documentElement.firstElementChild = liveAnchors[0] || null;

  for (let index = 0; index < liveAnchors.length; index += 1) {
    liveAnchors[index].nextElementSibling = liveAnchors[index + 1] || null;
  }

  assert.equal(state.candidateFullReindexPending, true, "前置条件：仍处于待重建状态");

  while (navigation.processCandidateMutationWorkBatch().hasPendingWork) {
    // 排空
  }

  assert.equal(state.candidateFullReindexPending, false, "全量重建后标记应当清掉");

  const links = navigation.collectCandidateLinks();
  assert.equal(
    links.length,
    liveAnchors.length,
    "全量重建后应当索引到文档里全部存活的链接 —— 丢弃积压不得损失正确性"
  );
}

// --- 3. 收满 MAX_CANDIDATE_LINKS 之后仍要清理已分离条目 ---
{
  navigation.resetCandidateAnchorIndex();

  // 先放满超过 MAX_CANDIDATE_LINKS 的可见 anchor，再在**后面**追加已分离的。
  // Map 按插入序迭代，所以已分离的那批一定排在收集停止之后。
  const visibleAnchors = Array.from({ length: constants.MAX_CANDIDATE_LINKS + 5 }, (_, index) =>
    makeAnchor(`https://visible.example/page-${index}`)
  );
  const detachedAnchors = Array.from({ length: 25 }, (_, index) =>
    makeAnchor(`https://detached.example/page-${index}`, { isConnected: false })
  );

  for (const anchor of [...visibleAnchors, ...detachedAnchors]) {
    state.candidateAnchorEntries.set(anchor, {
      link: {
        url: anchor.href,
        targetHint: "_self",
        visibility: 500,
      },
    });
  }

  const sizeBefore = state.candidateAnchorEntries.size;
  const links = navigation.collectCandidateLinks();

  assert.equal(
    links.length,
    constants.MAX_CANDIDATE_LINKS,
    "收集数量上限本身不应改变"
  );
  assert.equal(
    state.candidateAnchorEntries.size,
    sizeBefore - detachedAnchors.length,
    `已分离条目没有被清理：${sizeBefore} -> ${state.candidateAnchorEntries.size}，` +
      `应当降到 ${sizeBefore - detachedAnchors.length}。` +
      "收满上限就 break 会让排在后面的条目永远等不到 isConnected 检查。"
  );

  for (const anchor of detachedAnchors) {
    assert.equal(
      state.candidateAnchorEntries.has(anchor),
      false,
      "已分离的 anchor 仍留在强 Map 里"
    );
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "mutation backlog is capped while the consumer is stalled",
        "backlog overflow drops strong DOM references immediately",
        "backlog overflow schedules a full reindex",
        "full reindex restores the complete link set",
        "detached entries past MAX_CANDIDATE_LINKS are still swept",
      ],
    },
    null,
    2
  )
);

function makeAnchor(href, options = {}) {
  anchorSequence += 1;
  const top = 20 + (anchorSequence % 40);

  return {
    nodeType: 1,
    tagName: "A",
    isConnected: options.isConnected !== false,
    href,
    target: "",
    rel: "",
    innerText: `link-${anchorSequence}`,
    textContent: `link-${anchorSequence}`,
    parentElement: { innerText: "" },
    firstElementChild: null,
    nextElementSibling: null,
    closest: () => null,
    querySelector: () => null,
    getAttribute: (name) => (name === "href" ? href : null),
    hasAttribute: () => false,
    getBoundingClientRect: () => ({
      top,
      bottom: top + 20,
      left: 10,
      right: 210,
      width: 200,
      height: 20,
    }),
  };
}

function makeTraversalRoot(children) {
  const root = {
    nodeType: 1,
    tagName: "HTML",
    clientWidth: 1280,
    clientHeight: 800,
    firstElementChild: children[0] || null,
  };

  for (let index = 0; index < children.length; index += 1) {
    children[index].nextElementSibling = children[index + 1] || null;
  }

  return root;
}
