// 页面摘要必须由生命周期事件驱动，每个页面世代最多构建两次。
//
// 此前 markDocumentContentChanged() 在**每一批 DOM 变更**上作废 cachedPageContentSnapshot，
// 而构建摘要要读 document.body.innerText —— 依赖布局，读一次就强制浏览器把整页样式和布局
// 算完再遍历整棵渲染树；随后的 .replace(/\s+/g," ") 还要跑完整页文本。带跳秒时钟、实时
// 评论数、轮播的页面上 120ms 防抖永远合并不掉（1000ms 封顶），于是大约每秒重算一次。
//
// 本测试盯四件事：
//   1. DOM 变更**不再**触发重建；
//   2. document.title 变化（Gmail 的 `(3) 收件箱` 未读计数）不再击穿缓存；
//   3. 加载完成后定稿一次 —— 内容脚本是 document_start 注入的，加载期取到的是半成品；
//   4. 页面世代推进（URL / SPA 路由变化）仍然重建，且 { rebuild: true } 仍能显式强制。
//
// 顺带钉住注意力快照只做一次 querySelectorAll("video,audio")。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const moduleSources = await Promise.all(
  [
    "../../extension/scripts/navigation/shared.js",
    "../../extension/scripts/navigation/shared/text.js",
    "../../extension/scripts/navigation/shared/url.js",
    "../../extension/scripts/navigation/shared/focus.js",
    "../../extension/scripts/navigation/page-digest.js",
    "../../extension/scripts/navigation/attention.js",
  ].map(async (filePath) => ({
    filename: filePath.split("/").slice(-2).join("/"),
    source: await readFile(new URL(filePath, import.meta.url), "utf8"),
  }))
);

// 每次读 body.innerText 计一次 —— 这就是被测的「强制布局 + 全页遍历」。
let bodyTextReads = 0;
let mediaQueries = 0;
let mediaElements = [];
// 内容脚本是 document_start 注入的，加载期读到的正文与加载完成后不是同一份。
let bodyTextValue = "Partial body while loading. ".repeat(20);

const sandbox = {
  URL,
  console,
  Date,
  location: { href: "https://digest.example/article" },
  document: {
    title: "Article",
    readyState: "loading",
    prerendering: false,
    visibilityState: "visible",
    hidden: false,
    activeElement: null,
    documentElement: { nodeType: 1, tagName: "HTML" },
    hasFocus: () => true,
    get body() {
      return {
        get innerText() {
          bodyTextReads += 1;
          return bodyTextValue;
        },
      };
    },
    querySelectorAll(selector) {
      if (selector === "video,audio") {
        mediaQueries += 1;
        return mediaElements;
      }
      return [];
    },
  },
  window: {
    innerWidth: 1280,
    innerHeight: 800,
    setTimeout,
    clearTimeout,
    setInterval,
  },
};
sandbox.globalThis = sandbox;

const context = vm.createContext(sandbox);
for (const { filename, source } of moduleSources) {
  vm.runInContext(source, context, { filename });
}

const navigationContent = context.ZeroLatencyNavigationContent;
const { state } = navigationContent;

assert.equal(
  navigationContent.markDocumentContentChanged,
  undefined,
  "markDocumentContentChanged 仍然存在 —— 摘要缓存还挂在 DOM 变更上"
);
assert.equal(
  state.documentContentRevision,
  undefined,
  "documentContentRevision 仍然存在 —— 它没有第二个消费方，应当一并删除"
);
assert.equal(
  navigationContent.schedulePageDigestReport,
  undefined,
  "schedulePageDigestReport 是死代码，应当已删除"
);

// --- 1. 加载期：反复收集只构建一次 ---
{
  bodyTextReads = 0;
  const first = navigationContent.collectPageContentSnapshot();

  assert.equal(bodyTextReads, 1, "加载期第一次收集应当真的构建");
  assert.ok(first.textDigest.includes("Article"), "摘要里应当带标题");

  for (let index = 0; index < 20; index += 1) {
    navigationContent.collectPageContentSnapshot();
  }

  assert.equal(
    bodyTextReads,
    1,
    `加载期重复收集构建了 ${bodyTextReads} 次 —— 摘要仍在反复重建`
  );
}

// --- 2. title 变化不得击穿缓存 ---
{
  bodyTextReads = 0;
  // Gmail / Discord 把未读数写进标题，每次计数跳动都是一次 title 变化。
  for (const unreadCount of [1, 2, 3, 4, 5]) {
    context.document.title = `(${unreadCount}) Article`;
    navigationContent.collectPageContentSnapshot();
  }

  assert.equal(
    bodyTextReads,
    0,
    `title 变化触发了 ${bodyTextReads} 次重建 —— 未读计数会让缓存形同虚设`
  );
}

// --- 3. 加载完成后定稿一次，且只定稿一次；定稿内容必须来自加载完成后的页面 ---
{
  const loadingSnapshot = navigationContent.collectPageContentSnapshot();
  assert.ok(
    loadingSnapshot.textDigest.includes("Partial body while loading"),
    "加载期的快照本应取到半成品正文，夹具不成立"
  );

  context.document.title = "Article";
  context.document.readyState = "complete";
  bodyTextValue = "Complete body of the article. ".repeat(200);
  bodyTextReads = 0;

  const sealed = navigationContent.collectPageContentSnapshot();
  assert.equal(bodyTextReads, 1, "加载完成后应当定稿一次（加载期取到的是半成品）");
  assert.equal(sealed.pageLoadComplete, true, "定稿快照没有标记 pageLoadComplete");
  assert.ok(
    sealed.textDigest.includes("Complete body of the article"),
    "定稿摘要仍是加载期那份半成品 —— 「只建一次」建在了错误的时刻"
  );
  assert.ok(
    !sealed.textDigest.includes("Partial body while loading"),
    "定稿摘要里混进了加载期内容"
  );
  assert.notEqual(
    sealed.contentFingerprint,
    loadingSnapshot.contentFingerprint,
    "定稿后 contentFingerprint 没有变化 —— 后台无从得知摘要已更新"
  );

  for (let index = 0; index < 20; index += 1) {
    navigationContent.collectPageContentSnapshot();
  }

  assert.equal(
    bodyTextReads,
    1,
    `定稿后又构建了 ${bodyTextReads - 1} 次 —— 应当此后不再重算`
  );
}

// --- 4. 世代推进仍然重建；rebuild 仍能显式强制 ---
{
  bodyTextReads = 0;
  assert.equal(
    navigationContent.advancePageGeneration("https://digest.example/other"),
    true,
    "URL 变化应当推进页面世代"
  );
  assert.equal(
    state.cachedPageContentSnapshot,
    null,
    "世代推进没有作废缓存 —— 换页面必须重建"
  );

  navigationContent.collectPageContentSnapshot();
  assert.equal(bodyTextReads, 1, "新页面世代应当重建一次");

  navigationContent.collectPageContentSnapshot();
  assert.equal(bodyTextReads, 1, "新页面世代内又重复构建了");

  navigationContent.collectPageContentSnapshot({ rebuild: true });
  assert.equal(bodyTextReads, 2, "{ rebuild: true } 没有强制重建 —— 显式覆盖失效");
}

// --- 5. 注意力快照只做一次 querySelectorAll，且 video/audio 判定不变 ---
{
  const makeMedia = (tagName, overrides = {}) => ({
    tagName,
    paused: false,
    ended: false,
    readyState: 4,
    ...overrides,
  });

  mediaElements = [makeMedia("VIDEO"), makeMedia("AUDIO")];
  mediaQueries = 0;
  let snapshot = navigationContent.buildAttentionActivitySnapshot();

  assert.equal(
    mediaQueries,
    1,
    `注意力快照做了 ${mediaQueries} 次 querySelectorAll("video,audio") —— 同一份查询被重复执行`
  );
  assert.equal(snapshot.videoPlaybackActive, true);
  assert.equal(snapshot.audioPlaybackActive, true);

  // 判定条件必须与合并前逐条一致。
  mediaElements = [makeMedia("VIDEO", { paused: true }), makeMedia("AUDIO", { ended: true })];
  snapshot = navigationContent.buildAttentionActivitySnapshot();
  assert.equal(snapshot.videoPlaybackActive, false, "暂停的 video 被判为播放中");
  assert.equal(snapshot.audioPlaybackActive, false, "已结束的 audio 被判为播放中");

  mediaElements = [makeMedia("VIDEO", { readyState: 1 })];
  snapshot = navigationContent.buildAttentionActivitySnapshot();
  assert.equal(snapshot.videoPlaybackActive, false, "readyState <= 1 的 video 被判为播放中");

  mediaElements = [makeMedia("AUDIO")];
  snapshot = navigationContent.buildAttentionActivitySnapshot();
  assert.equal(snapshot.videoPlaybackActive, false, "只有 audio 时 video 不应为真");
  assert.equal(snapshot.audioPlaybackActive, true);

  mediaElements = [];
  snapshot = navigationContent.buildAttentionActivitySnapshot();
  assert.equal(snapshot.videoPlaybackActive, false);
  assert.equal(snapshot.audioPlaybackActive, false);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "DOM-change invalidation hooks are gone",
        "loading phase builds the digest once and reuses it",
        "title churn does not invalidate the digest",
        "load completion seals the digest exactly once",
        "page generation advance rebuilds",
        "{ rebuild: true } still forces a rebuild",
        "attention snapshot queries video,audio once",
        "video/audio verdicts unchanged after merging the two passes",
      ],
    },
    null,
    2
  )
);
