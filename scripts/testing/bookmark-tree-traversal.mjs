// 书签树遍历必须是显式栈 + 硬上限，且结果与原递归版逐字一致。
//
// chrome.bookmarks.getTree() 的深度和节点数完全由用户决定（还包括任何持 bookmarks 权限的
// 其他扩展、以及书签 HTML 导入），属于项目契约里的「外部未知规模数据」——契约要求这类遍历
// 用 while + 显式栈，并带去重集合与深度/节点硬上限。此前 collectChromeBookmarkNodeEntries
// 是无上限自递归，而这条路径每 5 秒（BOOKMARK_PRELOAD_CACHE_TTL_MS）就重走一遍整棵树。
//
// 本测试用**原递归实现本身**当 oracle 做逐字对比：bookmarkIndex 编码书签次序，
// selectBetterBookmarkPreloadEntry 会拿它做 Math.min，顺序错了会静默改变去重后留下的条目。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// SW 打包后是同一个 classic script，constants.js 的顶层 const 对 collection.js 可见。
// 测试必须同样拼接后作为**一个** script 运行，否则顶层 const 不跨 runInContext 可见。
const bundleSource = [
  "../../extension/background/preload/prediction/bookmarks/constants.js",
  "../../extension/background/preload/prediction/bookmarks/collection.js",
]
  .map((filePath) => readFileSync(new URL(filePath, import.meta.url), "utf8"))
  .join("\n");

// 顶层 `const` **不会**成为 globalThis 属性，所以这两个上限读不到 vm context 上
// （`context.BOOKMARK_PRELOAD_MAX_TREE_DEPTH === undefined`）。从源码解析，避免测试里
// 写死一份会和实现漂移的副本。见 docs/internal/invariants.md 第 4 条。
function readNumericConstant(name) {
  const match = bundleSource.match(new RegExp(`\\b${name}\\s*=\\s*([0-9_]+)`));
  assert.ok(match, `没能从源码里解析出常量 ${name}`);
  return Number(match[1].replace(/_/g, ""));
}

const MAX_TREE_DEPTH = readNumericConstant("BOOKMARK_PRELOAD_MAX_TREE_DEPTH");
const MAX_TREE_NODES = readNumericConstant("BOOKMARK_PRELOAD_MAX_TREE_NODES");

const sandbox = {
  console,
  Math,
  Number,
  String,
  Array,
  Object,
  Map,
  Set,
  Date,
  normalizeNavigableUrl: (rawUrl) =>
    typeof rawUrl === "string" && /^https?:\/\//.test(rawUrl) ? rawUrl : "",
  normalizePageUrlForIndex: (rawUrl) => String(rawUrl ?? ""),
  isExcludedTrackingPage: () => false,
  derivePageLabel: () => "",
  recordGoogleBookmarkPreloadDiagnostic: () => {},
};
sandbox.globalThis = sandbox;

const context = vm.createContext(sandbox);
vm.runInContext(bundleSource, context, { filename: "bookmarks-bundle.js" });

const { collectChromeBookmarkTreeEntries, selectBetterBookmarkPreloadEntry, normalizeBookmarkTitle } =
  context;

assert.equal(typeof collectChromeBookmarkTreeEntries, "function");
assert.equal(
  context.collectChromeBookmarkNodeEntries,
  undefined,
  "原递归函数仍然存在 —— 应当已被显式栈版本取代"
);

// --- oracle：改造前的递归实现，逐字保留 ---
function collectViaRecursion(tree, sourceUrl) {
  const entriesByUrl = new Map();
  let bookmarkIndex = 0;
  const nextIndex = () => {
    bookmarkIndex += 1;
    return bookmarkIndex;
  };

  function walk(node) {
    if (!node || typeof node !== "object") {
      return;
    }

    if (typeof node.url === "string" && node.url) {
      const candidateUrl = sandbox.normalizeNavigableUrl(node.url, sourceUrl);
      const targetPageUrl = sandbox.normalizePageUrlForIndex(candidateUrl || "");

      if (candidateUrl && targetPageUrl && !sandbox.isExcludedTrackingPage(candidateUrl)) {
        const existingEntry = entriesByUrl.get(targetPageUrl);
        const nextEntry = {
          url: candidateUrl,
          targetPageUrl,
          title: normalizeBookmarkTitle(node.title, candidateUrl),
          bookmarkIndex: nextIndex(),
        };

        entriesByUrl.set(
          targetPageUrl,
          existingEntry ? selectBetterBookmarkPreloadEntry(existingEntry, nextEntry) : nextEntry
        );
      }
    }

    for (const child of Array.isArray(node.children) ? node.children : []) {
      walk(child);
    }
  }

  for (const node of Array.isArray(tree) ? tree : []) {
    walk(node);
  }

  return entriesByUrl;
}

function runNew(tree, sourceUrl) {
  const entriesByUrl = new Map();
  const traversal = collectChromeBookmarkTreeEntries(tree, sourceUrl, entriesByUrl);
  return { entriesByUrl, traversal };
}

// 不能直接 deepEqual 两个 Map：oracle 的对象字面量建在宿主 realm，新实现的建在 vm realm，
// deepStrictEqual 会比对原型而判不等。比对投影，顺便让失败信息可读。
function projectEntries(entriesByUrl) {
  return [...entriesByUrl.entries()].map(([key, entry]) => [
    key,
    entry.url,
    entry.targetPageUrl,
    entry.title,
    entry.bookmarkIndex,
  ]);
}

// --- 1. 顺序与去重结果必须与递归版逐字一致 ---
{
  // 刻意包含：重复 URL（触发 selectBetterBookmarkPreloadEntry 的 Math.min）、
  // 长短标题混排、非 http scheme、纯文件夹节点、空 children、非法节点。
  const tree = [
    {
      title: "Bookmarks bar",
      children: [
        { title: "A", url: "https://a.test/" },
        {
          title: "Folder 1",
          children: [
            { title: "Longer title for B", url: "https://b.test/" },
            { title: "C", url: "https://c.test/" },
            { title: "javascript link", url: "javascript:void(0)" },
            null,
            "not an object",
            {
              title: "Folder 1.1",
              children: [
                { title: "D", url: "https://d.test/" },
                { title: "A again with a much longer title", url: "https://a.test/" },
              ],
            },
          ],
        },
        { title: "B", url: "https://b.test/" },
        { title: "Empty folder", children: [] },
      ],
    },
    {
      title: "Other bookmarks",
      children: [
        { title: "E", url: "https://e.test/" },
        { title: "", url: "https://f.test/" },
      ],
    },
  ];

  const expected = collectViaRecursion(tree, "https://source.test/");
  const { entriesByUrl, traversal } = runNew(tree, "https://source.test/");

  assert.deepEqual(
    projectEntries(entriesByUrl),
    projectEntries(expected),
    "显式栈遍历的结果与递归版不一致 —— 顺序或去重语义被改变了"
  );
  assert.equal(traversal.truncatedBy, "", "正常规模的树不应触发截断");
  assert.equal(traversal.maxDepthReached, 3, "深度统计不对");
}

// --- 2. 深层嵌套不得栈溢出（这是改造的直接理由）---
{
  const DEPTH = 20_000;
  let deepest = { title: "leaf", url: "https://leaf.test/" };

  for (let index = 0; index < DEPTH; index += 1) {
    deepest = { title: `folder-${index}`, children: [deepest] };
  }

  // 先确认这个夹具确实能压垮递归版 —— 否则本条断言是空的。
  let recursionOverflowed = false;
  try {
    collectViaRecursion([deepest], "https://source.test/");
  } catch (error) {
    recursionOverflowed = error instanceof RangeError;
  }
  assert.ok(
    recursionOverflowed,
    `深度 ${DEPTH} 没有压垮递归版 —— 夹具不足以证明改造的必要性，需要加深`
  );

  const { traversal } = runNew([deepest], "https://source.test/");
  assert.equal(traversal.truncatedBy, "depth-limit", "超深树应当按深度上限截断");
  assert.equal(
    traversal.maxDepthReached,
    MAX_TREE_DEPTH,
    "深度统计应当停在上限处"
  );
}

// --- 3. 节点预算触顶必须被报告，不静默截断 ---
{
  const wideChildren = [];

  for (let index = 0; index < MAX_TREE_NODES + 10; index += 1) {
    wideChildren.push({ title: `bookmark-${index}`, url: `https://wide.test/${index}` });
  }

  const { entriesByUrl, traversal } = runNew(
    [{ title: "Wide", children: wideChildren }],
    "https://source.test/"
  );

  assert.equal(traversal.truncatedBy, "node-budget", "节点预算触顶没有被报告");
  assert.ok(
    entriesByUrl.size < wideChildren.length,
    "既然报告了截断，收集到的条目就应当少于全部节点"
  );
  assert.ok(
    traversal.visitedNodes > MAX_TREE_NODES,
    "访问计数应当在越过预算时才停"
  );
}

// --- 4. 有环结构必须终止（去重集合的作用）---
{
  const cyclic = { title: "Loop", url: "https://loop.test/" };
  cyclic.children = [cyclic, { title: "Inner", url: "https://inner.test/" }];

  const { entriesByUrl, traversal } = runNew([cyclic], "https://source.test/");

  assert.equal(traversal.truncatedBy, "", "有环但节点很少，不应触发任何上限");
  assert.equal(traversal.visitedNodes, 2, "环上的节点被重复访问了 —— 去重集合失效");
  assert.ok(entriesByUrl.has("https://loop.test/"));
  assert.ok(entriesByUrl.has("https://inner.test/"));
}

// --- 5. 空输入与非数组输入 ---
{
  for (const input of [[], null, undefined, "nope", {}]) {
    const { entriesByUrl, traversal } = runNew(input, "https://source.test/");
    assert.equal(entriesByUrl.size, 0);
    assert.equal(traversal.visitedNodes, 0);
    assert.equal(traversal.truncatedBy, "");
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "recursive implementation is gone",
        "explicit-stack traversal matches the recursive oracle byte for byte",
        "deep nesting that overflows recursion is handled",
        "depth limit truncates and reports",
        "node budget truncates and reports",
        "cyclic structures terminate via the visited set",
        "empty and malformed inputs are inert",
      ],
    },
    null,
    2
  )
);
