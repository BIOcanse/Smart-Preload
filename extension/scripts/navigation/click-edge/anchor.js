(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const {
    normalizeNavigableHref,
    getAnchorNavigationTarget,
    resolveManagedNavigationTarget,
    shouldUseBrowserDefaultForPreloadSafety,
    hasCachedSafeCandidateAnchor,
  } = namespace;

  function findNavigableAnchorFromEvent(event) {
    const anchor = event
      .composedPath()
      .find((node) => node instanceof HTMLAnchorElement && node.href);

    if (!(anchor instanceof HTMLAnchorElement)) {
      return null;
    }

    if (anchor.hasAttribute("download")) {
      return null;
    }

    return anchor;
  }

  // options.anchor 让调用方复用自己已经找好的 anchor，避免重复走 composedPath()。
  function getTrackedAnchorNavigation(event, options = {}) {
    const anchor = options.anchor ?? findNavigableAnchorFromEvent(event);

    if (!anchor) {
      return null;
    }

    const targetUrl = normalizeNavigableHref(anchor.href);
    const rawNavigationTarget = getAnchorNavigationTarget(anchor);
    const navigationTarget = resolveManagedNavigationTarget(
      location.href,
      targetUrl,
      rawNavigationTarget
    );

    if (!targetUrl || !navigationTarget) {
      return null;
    }

    // 候选扫描缓存命中即代表同一份判定已经通过，跳过重算（省两次强制布局）；
    // 未命中就退回现算，最坏情况与改动前完全一致。
    if (
      hasCachedSafeCandidateAnchor?.(anchor, targetUrl) !== true &&
      shouldUseBrowserDefaultForPreloadSafety?.(anchor, targetUrl)
    ) {
      return null;
    }

    return {
      anchor,
      targetUrl,
      rawNavigationTarget,
      navigationTarget,
    };
  }

  function isTextSelectionActive() {
    const selection = window.getSelection?.();

    return Boolean(
      selection &&
        selection.isCollapsed === false &&
        String(selection.toString() || "").trim()
    );
  }

  Object.assign(namespace, {
    findNavigableAnchorFromEvent,
    getTrackedAnchorNavigation,
    isTextSelectionActive,
  });
})();
