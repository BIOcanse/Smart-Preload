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
    if (!isTraversableNode(node)) {
      return;
    }

    const existingWorkItem = state.candidateQueuedTraversalItems.get(node);

    if (existingWorkItem) {
      existingWorkItem.includeNextSibling =
        existingWorkItem.includeNextSibling || includeNextSibling === true;
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
    const element = getElementForMutationNode(node);

    if (!element) {
      return;
    }

    const anchor = isAnchorElement(element) ? element : element.closest?.("a") ?? null;

    if (anchor) {
      state.candidateDirtyAnchors.set(anchor, true);
    }
  }

  function processCandidateMutationWorkBatch(options = {}) {
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

      const link = entry?.link;

      if (!link?.url || link.visibility <= 0 || seen.has(link.url)) {
        continue;
      }

      seen.add(link.url);
      links.push(link);

      if (links.length >= constants.MAX_CANDIDATE_LINKS) {
        break;
      }
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
  });
})();
