(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});

  function normalizeNavigableHref(rawHref) {
    try {
      const url = new URL(rawHref, location.href);

      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return null;
      }

      if (url.href === location.href) {
        return null;
      }

      const currentWithoutHash = new URL(location.href);
      currentWithoutHash.hash = "";
      const targetWithoutHash = new URL(url.href);
      targetWithoutHash.hash = "";

      if (currentWithoutHash.href === targetWithoutHash.href) {
        return null;
      }

      return url.href;
    } catch (_error) {
      return null;
    }
  }

  function getAnchorNavigationTarget(anchor) {
    const normalizedTarget = (anchor.target || "_self").toLowerCase();

    if (normalizedTarget === "" || normalizedTarget === "_self") {
      return "_self";
    }

    if (normalizedTarget === "_blank") {
      return "_blank";
    }

    return null;
  }

  function resolveManagedNavigationTarget(sourceUrl, targetUrl, rawTargetHint) {
    const normalizedTargetHint = rawTargetHint === "_blank" ? "_blank" : "_self";

    if (
      normalizedTargetHint === "_blank" &&
      isGoogleSearchResultsPageUrl(sourceUrl) &&
      !isGoogleSearchInternalModeNavigation(sourceUrl, targetUrl)
    ) {
      return "_self";
    }

    return normalizedTargetHint;
  }

  function isGoogleSearchResultsPageUrl(rawUrl) {
    return Boolean(getGoogleSearchContext(rawUrl));
  }

  function isGoogleSearchInternalModeNavigation(sourceUrl, targetUrl) {
    const sourceSearchContext = getGoogleSearchContext(sourceUrl);
    const targetSearchContext = getGoogleSearchContext(targetUrl);

    if (!sourceSearchContext || !targetSearchContext) {
      return false;
    }

    return (
      sourceSearchContext.origin === targetSearchContext.origin &&
      sourceSearchContext.query === targetSearchContext.query
    );
  }

  function getGoogleSearchContext(rawUrl) {
    try {
      const url = new URL(rawUrl, location.href);
      const hostname = url.hostname.toLowerCase();
      const isGoogleHost =
        hostname === "google.com" ||
        hostname === "www.google.com" ||
        hostname.startsWith("google.") ||
        hostname.startsWith("www.google.");
      const isSearchPath = url.pathname === "/search";
      const query = (url.searchParams.get("q") || "").trim();

      if (!isGoogleHost || !isSearchPath || !query) {
        return null;
      }

      return {
        origin: url.origin,
        query,
      };
    } catch (_error) {
      return null;
    }
  }

  Object.assign(namespace, {
    normalizeNavigableHref,
    getAnchorNavigationTarget,
    resolveManagedNavigationTarget,
    isGoogleSearchResultsPageUrl,
    isGoogleSearchInternalModeNavigation,
  });
})();
