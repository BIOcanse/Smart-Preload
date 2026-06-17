(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const {
    normalizeNavigableHref,
    getAnchorNavigationTarget,
    resolveManagedNavigationTarget,
    shouldUseBrowserDefaultForPreloadSafety,
  } = namespace;

  function getTrackedAnchorNavigation(event) {
    const anchor = event
      .composedPath()
      .find((node) => node instanceof HTMLAnchorElement && node.href);

    if (!(anchor instanceof HTMLAnchorElement)) {
      return null;
    }

    if (anchor.hasAttribute("download")) {
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

    if (shouldUseBrowserDefaultForPreloadSafety?.(anchor, targetUrl)) {
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
    getTrackedAnchorNavigation,
    isTextSelectionActive,
  });
})();
