(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const {
    constants,
    state,
    normalizeShortText,
    normalizeLongText,
    normalizeNavigableHref,
    getAnchorNavigationTarget,
    resolveManagedNavigationTarget,
    isGoogleSearchInternalModeNavigation,
    collectAnchorPreloadSafety,
    inspectAnchorSideEffectPreloadSafety,
    shouldSkipSensitivePagePreload,
  } = namespace;

  function initializeCandidateAnchorIndex(root = document.documentElement) {
    if (!root) {
      return false;
    }

    enqueueCandidateTraversalRoot(root);
    return true;
  }

  function resetCandidateAnchorIndex() {
    state.candidateVisibilityObserver?.disconnect?.();
    state.candidateVisibilityObserver = null;
    state.candidateMutationWorkQueue = [];
    state.candidateQueuedTraversalItems = new WeakMap();
    state.candidateDirtyAnchors = new Map();
    state.candidateAnchorEntries = new Map();
    state.candidateVisibilityCache = new WeakMap();
    state.candidateFullReindexPending = false;
  }

  function enqueueCandidateMutations(mutations) {
    for (const mutation of Array.isArray(mutations) ? mutations : []) {
      enqueueClosestCandidateAnchor(mutation?.target);

      if (mutation?.type !== "childList") {
        continue;
      }

      for (const node of mutation.removedNodes || []) {
        enqueueCandidateTraversalRoot(node);
      }

      for (const node of mutation.addedNodes || []) {
        enqueueCandidateTraversalRoot(node);
      }
    }
  }

  function enqueueCandidateTraversalRoot(node) {
    enqueueCandidateTraversalNode(node, false);
  }

  function enqueueCandidateTraversalNode(node, includeNextSibling) {
    if (!isTraversableNode(node) || state.candidateFullReindexPending) {
      return;
    }

    const existingWorkItem = state.candidateQueuedTraversalItems.get(node);

    if (existingWorkItem) {
      existingWorkItem.includeNextSibling =
        existingWorkItem.includeNextSibling || includeNextSibling === true;
      return;
    }

    if (state.candidateMutationWorkQueue.length >= constants.MAX_CANDIDATE_MUTATION_QUEUE) {
      dropCandidateMutationBacklog("queue-overflow");
      return;
    }

    const workItem = {
      node,
      includeNextSibling: includeNextSibling === true,
    };
    state.candidateQueuedTraversalItems.set(node, workItem);
    state.candidateMutationWorkQueue.push(workItem);
  }

  function enqueueClosestCandidateAnchor(node) {
    if (state.candidateFullReindexPending) {
      return;
    }

    const element = getElementForMutationNode(node);

    if (!element) {
      return;
    }

    const anchor = isAnchorElement(element) ? element : element.closest?.("a") ?? null;

    if (!anchor) {
      return;
    }

    if (
      !state.candidateDirtyAnchors.has(anchor) &&
      state.candidateDirtyAnchors.size >= constants.MAX_CANDIDATE_DIRTY_ANCHORS
    ) {
      dropCandidateMutationBacklog("dirty-anchor-overflow");
      return;
    }

    state.candidateDirtyAnchors.set(anchor, true);
  }

  // 积压触顶：丢掉全部增量工作，改为在下一次批处理时做一次全量重建。
  //
  // 必须这么做的原因是队列里持有的是**强 DOM 引用**：mutation.removedNodes 捕获的节点
  // 已经从文档里摘掉，只要还在队列里就无法回收。而消费者在可编辑元素获得焦点期间完全停摆
  // （scheduler.js 的 hasActiveEditableFocus 分支直接 return，focusin 还会清掉全部定时器），
  // 生产者却无条件运行 —— 长时间编辑会话里积压单调增长。
  //
  // 丢弃不损失正确性：全量重建会重新索引整棵文档，结果与逐条重放增量一致，只是更贵。
  // 代价是一次性的，而不是随会话时长累积的。
  function dropCandidateMutationBacklog(reason) {
    state.candidateMutationWorkQueue = [];
    state.candidateQueuedTraversalItems = new WeakMap();
    state.candidateDirtyAnchors = new Map();
    state.candidateFullReindexPending = true;
    // 不静默丢弃。内容脚本没有诊断上报通道，console.debug 是本目录既有的做法
    // （candidate-scan.js:114）。
    console.debug("Candidate mutation backlog dropped; falling back to a full reindex.", reason);
  }

  function processCandidateMutationWorkBatch(options = {}) {
    // 积压曾经触顶：增量记录已丢弃，先做一次全量重建再继续按批消费。
    if (state.candidateFullReindexPending) {
      state.candidateFullReindexPending = false;
      resetCandidateAnchorIndex();
      initializeCandidateAnchorIndex(document.documentElement);
    }

    const nodeLimit = resolveBatchLimit(
      options.nodeLimit,
      constants.CANDIDATE_MUTATION_NODE_BATCH_SIZE
    );
    const anchorLimit = resolveBatchLimit(
      options.anchorLimit,
      constants.CANDIDATE_DIRTY_ANCHOR_BATCH_SIZE
    );
    let visitedNodes = 0;
    let processedAnchors = 0;

    while (visitedNodes < nodeLimit && state.candidateMutationWorkQueue.length > 0) {
      const workItem = state.candidateMutationWorkQueue.pop();
      const node = workItem?.node;

      if (!node) {
        continue;
      }

      state.candidateQueuedTraversalItems.delete(node);
      visitedNodes += 1;

      if (workItem.includeNextSibling && node.nextElementSibling) {
        enqueueCandidateTraversalNode(node.nextElementSibling, true);
      }

      if (node.firstElementChild) {
        enqueueCandidateTraversalNode(node.firstElementChild, true);
      }

      if (isAnchorElement(node)) {
        state.candidateDirtyAnchors.set(node, true);
      }
    }

    while (processedAnchors < anchorLimit && state.candidateDirtyAnchors.size > 0) {
      const anchor = state.candidateDirtyAnchors.keys().next().value;
      state.candidateDirtyAnchors.delete(anchor);
      refreshCandidateAnchor(anchor);
      processedAnchors += 1;
    }

    return {
      visitedNodes,
      processedAnchors,
      hasPendingWork:
        state.candidateMutationWorkQueue.length > 0 || state.candidateDirtyAnchors.size > 0,
    };
  }

  function collectCandidateLinks() {
    if (shouldSkipSensitivePagePreload?.(location.href) === true) {
      return [];
    }

    const seen = new Set();
    const links = [];

    for (const [anchor, entry] of state.candidateAnchorEntries) {
      if (anchor?.isConnected === false) {
        removeCandidateAnchor(anchor);
        continue;
      }

      // 收满 MAX_CANDIDATE_LINKS 后**继续扫完整个 Map**，只是不再收集。
      //
      // 此前这里是 break：candidateAnchorEntries 是以 anchor 元素为 key 的**强** Map，
      // 而 Map 按插入序迭代，于是每次都只检查同样的前若干条，排在后面的已分离 anchor
      // 永远等不到 isConnected 检查。isConnected 只是一次布尔属性读取，不触发布局，
      // 扫完整个 Map 的代价远低于本函数其余部分。
      if (links.length >= constants.MAX_CANDIDATE_LINKS) {
        continue;
      }

      const link = entry?.link;

      if (!link?.url || link.visibility <= 0 || seen.has(link.url)) {
        continue;
      }

      seen.add(link.url);
      links.push(link);
    }

    return links;
  }

  function refreshCandidateAnchor(anchor) {
    if (!isUsableAnchor(anchor)) {
      removeCandidateAnchor(anchor);
      return;
    }

    const link = buildCandidateLink(anchor);

    if (!link) {
      removeCandidateAnchor(anchor);
      return;
    }

    state.candidateAnchorEntries.set(anchor, {
      link,
    });
    observeCandidateAnchorVisibility(anchor);
  }

  function buildCandidateLink(anchor) {
    const targetUrl = normalizeNavigableHref(anchor.href);
    const targetHint = resolveManagedNavigationTarget(
      location.href,
      targetUrl,
      getAnchorNavigationTarget(anchor)
    );

    if (
      !targetUrl ||
      !targetHint ||
      isGoogleSearchInternalModeNavigation(location.href, targetUrl)
    ) {
      return null;
    }

    const preloadSafetyDecision = inspectAnchorSideEffectPreloadSafety(anchor, targetUrl);

    if (preloadSafetyDecision.skipPreload === true) {
      return null;
    }

    return {
      url: targetUrl,
      targetHint,
      visibility: getVisibilityScore(anchor),
      anchorText: collectAnchorText(anchor),
      nearbyText: collectNearbyText(anchor),
      titleAttr: normalizeShortText(anchor.getAttribute("title")),
      ariaLabel: normalizeShortText(anchor.getAttribute("aria-label")),
      imageAlt: collectAnchorImageAlt(anchor),
      preloadSafety:
        preloadSafetyDecision.preloadSafety ?? collectAnchorPreloadSafety(anchor),
    };
  }

  // 候选扫描已经为每个 anchor 跑过一次 inspectAnchorSideEffectPreloadSafety 并缓存了结论，
  // 交互路径（hover / 点击）不必再算一遍 —— 那一遍要读 anchor.innerText 和
  // parentElement.innerText，两次都强制整页布局。
  //
  // 判定方向是单向可信的：buildCandidateLink 只在 skipPreload === false 时才返回条目，
  // 且它比交互路径**更严**（额外滤掉 isGoogleSearchInternalModeNavigation）。
  // 所以「有缓存条目」⇒「安全判定通过」；「无条目」含义不明（可能被拦、可能还没扫到），
  // 必须退回现算。link.visibility 与安全判定无关，这里不看。
  function hasCachedSafeCandidateAnchor(anchor, targetUrl) {
    if (!targetUrl || state.candidateDirtyAnchors.has(anchor)) {
      // 该 anchor 有尚未被批处理消化的变更，缓存里的结论已经不可信。
      return false;
    }

    return state.candidateAnchorEntries.get(anchor)?.link?.url === targetUrl;
  }

  function removeCandidateAnchor(anchor) {
    state.candidateVisibilityObserver?.unobserve?.(anchor);
    state.candidateVisibilityCache.delete(anchor);
    state.candidateDirtyAnchors.delete(anchor);
    state.candidateAnchorEntries.delete(anchor);
  }

  function observeCandidateAnchorVisibility(anchor) {
    const observer = ensureCandidateVisibilityObserver();
    observer?.observe?.(anchor);
  }

  function ensureCandidateVisibilityObserver() {
    if (state.candidateVisibilityObserver || typeof IntersectionObserver !== "function") {
      return state.candidateVisibilityObserver;
    }

    state.candidateVisibilityObserver = new IntersectionObserver((entries) => {
      let candidateVisibilityChanged = false;

      for (const visibilityEntry of entries || []) {
        const anchor = visibilityEntry?.target;
        const candidateEntry = state.candidateAnchorEntries.get(anchor);

        if (!candidateEntry?.link) {
          continue;
        }

        const visibility =
          visibilityEntry.isIntersecting && isElementStyleVisible(anchor)
            ? getRectVisibilityScore(visibilityEntry.boundingClientRect)
            : 0;
        const previousVisibility = candidateEntry.link.visibility;
        state.candidateVisibilityCache.set(anchor, visibility);

        if (visibility === previousVisibility) {
          continue;
        }

        candidateEntry.link = {
          ...candidateEntry.link,
          visibility,
        };
        candidateVisibilityChanged = true;
      }

      if (candidateVisibilityChanged) {
        namespace.scheduleCandidateScan?.({
          delayMs: constants.RESCAN_DELAY_MS,
        });
      }
    });
    return state.candidateVisibilityObserver;
  }

  function buildCandidateLinksSignature(links) {
    return (Array.isArray(links) ? links : [])
      .map((link) =>
        [
          link.url || "",
          link.targetHint || "",
          link.anchorText || "",
          link.nearbyText || "",
          link.titleAttr || "",
          link.ariaLabel || "",
          link.imageAlt || "",
          JSON.stringify(link.preloadSafety || {}),
          Number.isFinite(link.visibility) ? String(link.visibility) : "",
        ].join("\u001f")
      )
      .join("\u001e");
  }

  function collectAnchorText(anchor) {
    return normalizeShortText(anchor?.innerText || anchor?.textContent || "");
  }

  function collectNearbyText(anchor) {
    const container = anchor?.closest?.("article, section, li, div, p") ?? anchor?.parentElement;

    if (container === document.body || container === document.documentElement) {
      return "";
    }

    const containerText = normalizeLongText(container?.innerText || "");
    const anchorText = collectAnchorText(anchor);

    if (!containerText) {
      return "";
    }

    if (!anchorText) {
      return containerText.slice(0, constants.MAX_NEARBY_TEXT_CHARS);
    }

    return containerText
      .replace(anchorText, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, constants.MAX_NEARBY_TEXT_CHARS);
  }

  function collectAnchorImageAlt(anchor) {
    const imageAlt = anchor?.querySelector?.("img[alt]")?.getAttribute?.("alt") || "";
    return normalizeShortText(imageAlt);
  }

  function getVisibilityScore(anchor) {
    if (state.candidateVisibilityCache.has(anchor)) {
      return state.candidateVisibilityCache.get(anchor);
    }

    const rect = anchor.getBoundingClientRect();
    let visibility = getRectVisibilityScore(rect);

    if (visibility > 0 && !isElementStyleVisible(anchor)) {
      visibility = 0;
    }

    state.candidateVisibilityCache.set(anchor, visibility);
    return visibility;
  }

  function getRectVisibilityScore(rect) {
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return 0;
    }

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

    if (
      rect.right <= 0 ||
      rect.left >= viewportWidth ||
      rect.bottom <= 0 ||
      rect.top >= viewportHeight
    ) {
      return 0;
    }

    return Math.max(1, Math.round(1000 - Math.max(rect.top, 0)));
  }

  function isElementStyleVisible(element) {
    const style = window.getComputedStyle?.(element);
    return !style || (style.visibility !== "hidden" && style.display !== "none");
  }

  function isUsableAnchor(anchor) {
    return (
      isAnchorElement(anchor) &&
      anchor?.isConnected !== false &&
      anchor.getAttribute?.("href") !== null
    );
  }

  function isAnchorElement(node) {
    return String(node?.tagName || "").toUpperCase() === "A";
  }

  function isTraversableNode(node) {
    return Boolean(node && (node.nodeType === 1 || node.nodeType === 11));
  }

  function getElementForMutationNode(node) {
    if (node?.nodeType === 1) {
      return node;
    }

    return node?.parentElement ?? null;
  }

  function resolveBatchLimit(requestedLimit, configuredLimit) {
    const normalizedConfiguredLimit = Math.max(1, Number(configuredLimit) || 1);
    const normalizedRequestedLimit = Math.max(
      1,
      Number(requestedLimit) || normalizedConfiguredLimit
    );
    return Math.min(normalizedConfiguredLimit, normalizedRequestedLimit);
  }

  Object.assign(namespace, {
    initializeCandidateAnchorIndex,
    resetCandidateAnchorIndex,
    enqueueCandidateMutations,
    processCandidateMutationWorkBatch,
    collectCandidateLinks,
    buildCandidateLinksSignature,
    hasCachedSafeCandidateAnchor,
  });
})();
