// hover 路径不得为了安全判定重复做规则求值，且任何路径都不得读 innerText。
//
// **两轮改动叠加**：
//   1. 交互路径改为复用候选扫描 buildCandidateLink() 已经算好的结论
//      （同一个函数、同一批输入，属记忆化而非近似）。
//   2. 敏感站点规则 v2 删掉全部文本提示判据后，安全判定**根本不再需要**读
//      anchor.innerText / parentElement.innerText —— 强制布局的根源从此消失。
//
// 所以这里量两件事：规则求值次数（缓存是否生效）、以及 innerText 读取次数（必须恒为 0）。
//
// 另有一处顺序问题：pointerover 会冒泡，鼠标在同一个链接内部从 <img> 移到 <span>
// 会再触发一次；而 handleLinkHover 的「还是同一个 anchor 就 return」去重写在
// getTrackedAnchorNavigation() **之后**，等于每次都先付掉两次布局才发现结果要丢弃。
//
// 本测试盯四件事：
//   1. 判定结论不变 —— 走缓存与从零现算，对每个 anchor 必须给出同一个结论；
//   2. 缓存命中不再求值规则，缓存失效（未扫到 / 标脏 / href 变了）必须退回现算；
//   3. 同一链接内的重复 pointerover 不再产生规则求值；
//   4. **安全判定路径全程不读 innerText**。
//
// 注意第 4 条只覆盖安全判定路径。候选扫描的 collectAnchorText / collectNearbyText
// 仍然读 innerText —— 那是喂后台 AI 关键词打分的，属另一个合法消费方，不在本测试范围。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const moduleSources = await Promise.all(
  [
    "../../extension/shared/preload-safety-rules/constants.js",
    "../../extension/shared/preload-safety-rules/url.js",
    "../../extension/shared/preload-safety-rules/decision.js",
    "../../extension/shared/preload-safety-rules/candidate.js",
    "../../extension/shared/preload-safety-rules.js",
    "../../extension/shared/sensitive-site-rules/constants.js",
    "../../extension/shared/sensitive-site-rules/url.js",
    "../../extension/shared/sensitive-site-rules/match.js",
    "../../extension/shared/sensitive-site-rules.js",
    "../../extension/scripts/navigation/shared.js",
    "../../extension/scripts/navigation/shared/text.js",
    "../../extension/scripts/navigation/shared/url.js",
    "../../extension/scripts/navigation/shared/focus.js",
    "../../extension/scripts/navigation/shared/safety.js",
    "../../extension/scripts/navigation/candidate-scan/links.js",
    "../../extension/scripts/navigation/click-edge/anchor.js",
  ].map(async (filePath) => ({
    filename: filePath.split("/").slice(-2).join("/"),
    source: await readFile(new URL(filePath, import.meta.url), "utf8"),
  }))
);
const interactionPreloadSource = await readFile(
  new URL("../../extension/scripts/navigation/click-edge/interaction-preload.js", import.meta.url),
  "utf8"
);

// 任何一次 innerText 读取都计数 —— v2 之后它必须恒为 0（强制布局的根源已删除）。
let layoutReads = 0;
// 规则求值次数 —— 缓存命中时应当为 0。
let ruleEvaluations = 0;

class HTMLAnchorElementStub {}

const anchors = [
  makeAnchor("https://example.com/docs/page", { text: "Safe page", top: 20 }),
  makeAnchor("https://example.com/guide", { text: "Another safe page", top: 40 }),
  makeAnchor("https://www.bankofamerica.com/accounts", { text: "Online banking", top: 60 }),
  makeAnchor("https://example.com/report", {
    attributes: { download: "report.csv" },
    text: "Download report",
    top: 80,
  }),
];
const [safeAnchor, secondSafeAnchor, sensitiveAnchor, downloadAnchor] = anchors;
const documentElement = makeTraversalRoot(anchors);

const sandbox = {
  URL,
  console,
  Node: class NodeStub {},
  HTMLAnchorElement: HTMLAnchorElementStub,
  location: { href: "https://source.example/start" },
  document: {
    title: "Hover safety fixture",
    readyState: "complete",
    prerendering: false,
    visibilityState: "visible",
    activeElement: null,
    documentElement,
    hasFocus: () => true,
  },
  window: {
    innerWidth: 1280,
    innerHeight: 800,
    setTimeout,
    clearTimeout,
    getSelection: () => ({ isCollapsed: true, toString: () => "" }),
    getComputedStyle: () => ({ display: "inline", visibility: "visible" }),
  },
};
sandbox.globalThis = sandbox;

const context = vm.createContext(sandbox);
for (const { filename, source } of moduleSources) {
  vm.runInContext(source, context, { filename });
}

// safety.js 在**调用时**才从 globalThis 取这个函数，所以可以事后包一层计数器。
const originalInspectSideEffect =
  context.ZeroLatencyPreloadSafetyRules.inspectSideEffectCandidateSafety;
context.ZeroLatencyPreloadSafetyRules.inspectSideEffectCandidateSafety = (...args) => {
  ruleEvaluations += 1;
  return originalInspectSideEffect(...args);
};

const navigationContent = context.ZeroLatencyNavigationContent;

// interaction-preload.js 在 IIFE 里解构依赖，桩必须先于它注入。
let attentionRecords = 0;
Object.assign(navigationContent, {
  isPassivePrerenderContext: () => false,
  requestInteractionPreloadStatus: async () => ({ preloaded: true }),
  requestInteractionPreload: async () => ({ ok: false }),
  cancelInteractionPreloads: () => {},
  applyInteractionSpeculationRules: () => {},
  recordLinkInteractionForAttention: () => {
    attentionRecords += 1;
  },
});
vm.runInContext(interactionPreloadSource, context, {
  filename: "click-edge/interaction-preload.js",
});

assert.equal(typeof navigationContent.hasCachedSafeCandidateAnchor, "function");
assert.equal(typeof navigationContent.findNavigableAnchorFromEvent, "function");
assert.equal(typeof navigationContent.handleLinkHover, "function");

// --- 基线：先记录每个 anchor 从零现算的结论 ---
const verdictsFromScratch = new Map(
  anchors.map((anchor) => [
    anchor,
    Boolean(navigationContent.getTrackedAnchorNavigation(pointerEventFor(anchor))),
  ])
);
assert.deepEqual(
  anchors.map((anchor) => verdictsFromScratch.get(anchor)),
  [true, true, false, false],
  "基线判定本身就不对，后面的对比没有意义"
);

// 建立候选索引。扫描期间 collectAnchorText / collectNearbyText 会读 innerText
// （喂 AI 关键词打分，属另一个消费方），所以之后清零 —— 下面量的是**安全判定路径**。
navigationContent.initializeCandidateAnchorIndex(documentElement);
while (navigationContent.processCandidateMutationWorkBatch().hasPendingWork) {
  // 排空这个小 fixture 的初始索引。
}
layoutReads = 0;

// --- 1. 结论不变：缓存路径与现算路径对每个 anchor 必须一致 ---
for (const anchor of anchors) {
  assert.equal(
    Boolean(navigationContent.getTrackedAnchorNavigation(pointerEventFor(anchor))),
    verdictsFromScratch.get(anchor),
    `缓存改变了 ${anchor.href} 的安全判定 —— 这条路必须是同一函数的记忆化，不是近似`
  );
}

// --- 2. 缓存命中不再强制布局 ---
{
  ruleEvaluations = 0;
  const navigation = navigationContent.getTrackedAnchorNavigation(pointerEventFor(safeAnchor));

  assert.ok(navigation, "缓存命中的安全链接被误拦");
  assert.equal(
    ruleEvaluations,
    0,
    `缓存命中仍求值了 ${ruleEvaluations} 次安全规则 —— 没有复用候选扫描的结论`
  );
}

// --- 3. 缓存失效必须退回现算 ---
{
  // 3a. 从未扫到的 anchor。
  const unscannedAnchor = makeAnchor("https://example.com/fresh", { text: "Never scanned" });
  ruleEvaluations = 0;
  assert.ok(
    navigationContent.getTrackedAnchorNavigation(pointerEventFor(unscannedAnchor)),
    "未扫到的安全链接被误拦"
  );
  assert.ok(ruleEvaluations > 0, "未命中缓存却没有现算 —— 无条目不等于安全");

  // 3b. 标脏的 anchor（有变更尚未被批处理消化）。
  navigationContent.state.candidateDirtyAnchors.set(safeAnchor, true);
  ruleEvaluations = 0;
  assert.ok(navigationContent.getTrackedAnchorNavigation(pointerEventFor(safeAnchor)));
  assert.ok(ruleEvaluations > 0, "anchor 已标脏却仍然信任缓存里的旧结论");
  navigationContent.state.candidateDirtyAnchors.delete(safeAnchor);

  // 3c. href 改成敏感地址、但批处理还没跑 —— url 比对必须兜住，判定要翻成拦截。
  secondSafeAnchor.href = "https://www.bankofamerica.com/transfer";
  ruleEvaluations = 0;
  assert.equal(
    navigationContent.getTrackedAnchorNavigation(pointerEventFor(secondSafeAnchor)),
    null,
    "href 改成敏感地址后仍按旧缓存放行 —— 陈旧缓存被当成了新判定"
  );
  assert.ok(ruleEvaluations > 0, "href 变化后没有重算");
}

// --- 4. 同一链接内的重复 pointerover 不再产生布局工作 ---
{
  navigationContent.state.hoverPreloadIntent = null;
  navigationContent.state.candidateDirtyAnchors.clear();
  navigationContent.state.candidateAnchorEntries.clear();
  attentionRecords = 0;

  // 清空缓存，让第一次 hover 走完整现算路径（最坏情况）。
  ruleEvaluations = 0;
  navigationContent.handleLinkHover(pointerEventFor(safeAnchor));

  assert.ok(ruleEvaluations > 0, "第一次 hover 应当真的算一遍");
  assert.ok(navigationContent.state.hoverPreloadIntent, "第一次 hover 没有建立 intent");

  // 模拟鼠标在同一个 <a> 内部从子元素移到另一个子元素：pointerover 再次冒泡上来。
  ruleEvaluations = 0;
  navigationContent.handleLinkHover(pointerEventFor(safeAnchor, { via: { nodeName: "SPAN" } }));
  navigationContent.handleLinkHover(pointerEventFor(safeAnchor, { via: { nodeName: "IMG" } }));

  assert.equal(
    ruleEvaluations,
    0,
    `同一链接内重复 pointerover 仍求值了 ${ruleEvaluations} 次规则 —— ` +
      "去重还在 getTrackedAnchorNavigation() 之后，昂贵的部分白算了"
  );
  assert.equal(
    attentionRecords,
    3,
    "重复 pointerover 的注意力记录次数与改动前不一致"
  );
}

// --- 5. 清空 intent 后同一 anchor 会重新走完整判定（去重不能变成永久缓存） ---
{
  navigationContent.state.hoverPreloadIntent = null;
  ruleEvaluations = 0;
  navigationContent.handleLinkHover(pointerEventFor(safeAnchor));
  assert.ok(ruleEvaluations > 0, "intent 被清掉后仍跳过判定 —— 去重被误当成长期缓存");
}

// --- 6. 安全判定路径全程不得读取 innerText ---
//
// 敏感站点规则 v2 删掉文本提示判据后，安全判定不再需要任何 DOM 文本。
// 这是整轮改动里最值钱的一条：innerText 依赖布局，读一次就强制浏览器把整页样式和
// 布局算完再遍历整棵渲染树，而这条路径在 hover / click / auxclick / contextmenu /
// mousedown 五个入口上。
assert.equal(
  layoutReads,
  0,
  `安全判定路径读了 ${layoutReads} 次 innerText —— 它又开始依赖 DOM 文本了。` +
    "innerText 依赖布局：读一次就强制浏览器把整页样式和布局算完再遍历整棵渲染树，" +
    "而这条路径在 hover / click / auxclick / contextmenu / mousedown 五个入口上。"
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "cached verdict matches from-scratch verdict for every anchor",
        "cache hit performs no rule evaluation",
        "unscanned anchor falls back to live evaluation",
        "dirty anchor falls back to live evaluation",
        "changed href re-evaluates and flips to blocked",
        "repeat pointerover inside one link performs no forced layout",
        "repeat pointerover keeps attention records unchanged",
        "cleared intent re-evaluates",
        "the safety path reads no innerText at all (forced layout eliminated at the root)",
      ],
    },
    null,
    2
  )
);

function pointerEventFor(anchor, options = {}) {
  const path = options.via ? [options.via, anchor] : [anchor];

  return {
    defaultPrevented: false,
    composedPath: () => path,
  };
}

function makeAnchor(href, options = {}) {
  const attributes = new Map(Object.entries(options.attributes || {}));
  const text = String(options.text || "");
  const top = Number.isFinite(Number(options.top)) ? Number(options.top) : 10;
  const anchor = new HTMLAnchorElementStub();

  Object.assign(anchor, {
    nodeType: 1,
    tagName: "A",
    isConnected: true,
    href,
    target: options.target || "",
    rel: attributes.get("rel") || "",
    textContent: text,
    // parentElement.innerText 是 nearbyText 的来源，同样强制布局。
    parentElement: makeLayoutText(text),
    closest: () => null,
    querySelector: () => null,
    getAttribute(name) {
      if (name === "href") {
        return anchor.href;
      }
      return attributes.has(name) ? attributes.get(name) : null;
    },
    hasAttribute: (name) => attributes.has(name),
    getBoundingClientRect: () => ({
      top,
      bottom: top + 20,
      left: 10,
      right: 210,
      width: 200,
      height: 20,
    }),
  });
  Object.defineProperty(anchor, "innerText", {
    get() {
      layoutReads += 1;
      return text;
    },
  });

  return anchor;
}

function makeLayoutText(text) {
  return {
    get innerText() {
      layoutReads += 1;
      return text;
    },
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
