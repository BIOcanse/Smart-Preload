(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const {
    constants,
    state,
    reportPageDigestToBackground,
    isPassivePrerenderContext,
    capturePageGenerationToken,
    isPageGenerationTokenCurrent,
  } = namespace;

  async function reportPageDigest(options = {}) {
    if (isPassivePrerenderContext()) {
      return;
    }

    const pageToken = options.pageToken ?? capturePageGenerationToken();

    if (!isPageGenerationTokenCurrent(pageToken)) {
      return;
    }

    const pageSnapshot = options.pageSnapshot ?? collectPageContentSnapshot();
    const nextPageDigestFingerprint = pageSnapshot.contentFingerprint;

    if (nextPageDigestFingerprint === state.lastReportedPageDigestFingerprint) {
      return;
    }

    try {
      await reportPageDigestToBackground({
        pageUrl: pageSnapshot.pageUrl,
        title: pageSnapshot.title,
        textDigest: pageSnapshot.textDigest,
        contentFingerprint: nextPageDigestFingerprint,
        attentionActivity: namespace.buildAttentionActivitySnapshot?.() ?? null,
      });

      if (isPageGenerationTokenCurrent(pageToken)) {
        state.lastReportedPageDigestFingerprint = nextPageDigestFingerprint;
      }
    } catch (_error) {
      // Ignore transient background messaging failures.
    }
  }

  function collectPageTextDigest() {
    return collectPageContentSnapshot().textDigest;
  }

  function buildPageContentFingerprint() {
    return collectPageContentSnapshot().contentFingerprint;
  }

  // 页面摘要按「每个页面世代最多建一次」构建，构建时机由生命周期事件决定，不再跟随 DOM 变更。
  //
  // 此前 markDocumentContentChanged() 在**每一批 DOM 变更**上作废这份缓存。而
  // document.body.innerText 依赖布局：读一次就强制浏览器把整页样式和布局算完，再遍历
  // 整棵渲染树。带跳秒时钟、实时评论数、视频时间戳、轮播广告的页面上，MutationObserver
  // 的 120ms 防抖永远合并不掉（还有 1000ms 封顶），于是整页摘要大约每秒重算一次。
  //
  // 现在的作废条件只剩两个，都是明确的生命周期事件：
  //   1. advancePageGeneration —— URL / SPA 路由变化。那是**新页面**，不是重建。
  //   2. 加载完成后的第一次收集 —— 内容脚本是 document_start 注入的（manifest.json:81），
  //      加载期间取到的是半成品，必须在 readyState === "complete" 之后定稿一次。
  //
  // 因此每个页面世代最多构建两次：加载期临时一份（期间反复收集复用它），加载完成后定稿
  // 一份，此后不再重算。调用方确实需要最新内容时传 { rebuild: true } 显式要求。
  //
  // **已知代价**：同一 URL 内的内容替换（无限滚动、路由内 tab 切换）不再更新摘要与
  // contentFingerprint。这是「只建一次」的直接含义，不是遗漏。
  function collectPageContentSnapshot(options = {}) {
    const pageUrl = state.currentPageUrl || location.href;
    const pageLoadComplete = document.readyState === "complete";
    const cachedSnapshot = state.cachedPageContentSnapshot;

    if (
      options.rebuild !== true &&
      cachedSnapshot?.pageGeneration === state.pageGeneration &&
      cachedSnapshot?.pageUrl === pageUrl &&
      // 加载期的临时快照在加载完成后必须让位一次；定稿后的快照不再让位。
      (cachedSnapshot.pageLoadComplete === true || pageLoadComplete !== true)
    ) {
      return cachedSnapshot;
    }

    // title 只在构建时读，且**不参与**缓存有效性判断：Gmail / Discord 这类站点把未读数
    // 写进 document.title（`(3) 收件箱`），把它当缓存键等于每次计数跳动都重算整页。
    const title = (document.title || "").trim();
    const bodyText = (document.body?.innerText || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, constants.MAX_TEXT_DIGEST_CHARS);
    const textDigest = [title, bodyText].filter(Boolean).join("\n\n");
    const sourceText = `${pageUrl}|${title}|${textDigest.slice(0, 800)}`;
    let hash = 2166136261;

    for (let index = 0; index < sourceText.length; index += 1) {
      hash ^= sourceText.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    state.cachedPageContentSnapshot = {
      pageGeneration: state.pageGeneration,
      pageUrl,
      pageLoadComplete,
      title,
      textDigest,
      contentFingerprint: `fp-${(hash >>> 0).toString(16)}`,
    };
    return state.cachedPageContentSnapshot;
  }

  Object.assign(namespace, {
    reportPageDigest,
    collectPageContentSnapshot,
    collectPageTextDigest,
    buildPageContentFingerprint,
  });
})();
