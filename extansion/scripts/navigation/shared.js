(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});

  const constants = {
    MAX_CANDIDATE_LINKS: 40,
    MAX_TEXT_DIGEST_CHARS: 2200,
    MAX_CANDIDATE_TEXT_CHARS: 240,
    MAX_NEARBY_TEXT_CHARS: 320,
    EARLY_LINK_RESCAN_DELAY_MS: 120,
    LINK_STABILITY_POLL_MS: 120,
    LINK_STABILITY_MAX_WAIT_MS: 900,
    BLANK_CLICK_RESOLUTION_TIMEOUT_MS: 500,
    CURRENT_TAB_CLICK_RESOLUTION_TIMEOUT_MS: 2500,
    WATERFALL_BASELINE_MAX_UNLOCKED_MS: 2500,
    RESCAN_DELAY_MS: 700,
    PAGE_DIGEST_DELAY_MS: 1500,
    ATTENTION_ACTIVITY_INTERVAL_MS: 15_000,
    ATTENTION_ACTIVITY_MIN_REPORT_INTERVAL_MS: 1_000,
    SPECULATION_RULES_ELEMENT_ID: "zero-latency-speculation-rules",
  };

  const state = {
    lastLocationHref: location.href,
    candidateScanTimerId: null,
    candidateScanDueAt: 0,
    candidateScanForce: false,
    candidateScanInFlight: false,
    candidateScanPending: false,
    pageDigestTimerId: null,
    observerStarted: false,
    observerReadinessListenerStarted: false,
    deferredScanWhileEditing: false,
    deferredPageDigestWhileEditing: false,
    lastSentCandidateSignature: null,
    fixedCandidateUrlSet: null,
    waterfallBaselineStartedAt: 0,
    waterfallBaselineLocked: false,
    ignoreWaterfallDynamicLinks: true,
    lastReportedPageDigestFingerprint: null,
    attentionActivityTimerId: null,
    lastUserInputAt: 0,
    lastAttentionActivityReportedAt: 0,
    lastAttentionActivitySignature: "",
  };

  function sleep(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
    });
  }

  function normalizeShortText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, constants.MAX_CANDIDATE_TEXT_CHARS);
  }

  function normalizeLongText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, constants.MAX_NEARBY_TEXT_CHARS);
  }

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

  function hasActiveEditableFocus() {
    const activeElement = document.activeElement;

    if (!(activeElement instanceof HTMLElement)) {
      return false;
    }

    if (activeElement.isContentEditable) {
      return true;
    }

    if (activeElement instanceof HTMLTextAreaElement) {
      return true;
    }

    if (activeElement instanceof HTMLInputElement) {
      const interactiveTypes = new Set([
        "text",
        "search",
        "email",
        "number",
        "password",
        "tel",
        "url",
      ]);

      return interactiveTypes.has((activeElement.type || "text").toLowerCase());
    }

    return false;
  }

  function isPassivePrerenderContext() {
    return document.prerendering === true;
  }

  Object.assign(namespace, {
    constants,
    state,
    sleep,
    normalizeShortText,
    normalizeLongText,
    normalizeNavigableHref,
    getAnchorNavigationTarget,
    resolveManagedNavigationTarget,
    isGoogleSearchResultsPageUrl,
    isGoogleSearchInternalModeNavigation,
    hasActiveEditableFocus,
    isPassivePrerenderContext,
  });
})();
