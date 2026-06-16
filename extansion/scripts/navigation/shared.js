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
    HOVER_PRELOAD_DELAY_MS: 80,
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
    hoverPreloadIntent: null,
    hoverPreloadSequence: 0,
    scheduledPrerenderTargets: [],
    scheduledPrefetchTargets: [],
    interactionPrerenderTargets: [],
    interactionPrefetchTargets: [],
  };
  const UNSAFE_PRELOAD_EXTENSIONS = new Set([
    "7z",
    "apk",
    "appx",
    "bat",
    "bin",
    "bz2",
    "cmd",
    "crx",
    "deb",
    "dmg",
    "exe",
    "gz",
    "img",
    "iso",
    "jar",
    "msi",
    "msix",
    "pkg",
    "ps1",
    "rar",
    "reg",
    "rpm",
    "sh",
    "tar",
    "tgz",
    "torrent",
    "xpi",
    "xz",
    "zip",
  ]);
  const DOWNLOAD_PRELOAD_PATH_TOKENS = new Set([
    "attachment",
    "attachments",
    "download",
    "download-file",
    "downloadfile",
    "downloads",
    "export",
    "exports",
  ]);
  const SIDE_EFFECT_PRELOAD_PATH_TOKENS = new Set([
    "cancel",
    "confirm",
    "delete",
    "destroy",
    "logout",
    "log-out",
    "remove",
    "signout",
    "sign-out",
    "unsubscribe",
  ]);
  const UNSAFE_PRELOAD_QUERY_KEYS = new Set([
    "attachment",
    "content-disposition",
    "dl",
    "download",
    "export",
    "file",
    "filename",
    "response-content-disposition",
  ]);
  const SIDE_EFFECT_PRELOAD_QUERY_VALUES = new Set([
    "cancel",
    "confirm",
    "delete",
    "destroy",
    "download",
    "export",
    "logout",
    "remove",
    "signout",
    "unsubscribe",
  ]);
  const UNSAFE_PRELOAD_MIME_HINTS = [
    "application/octet-stream",
    "application/x-msdownload",
    "application/x-msi",
    "application/zip",
    "application/x-7z-compressed",
    "application/x-rar-compressed",
    "application/x-tar",
    "application/gzip",
    "application/vnd.android.package-archive",
    "application/x-apple-diskimage",
  ];

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

  function collectAnchorPreloadSafety(anchor) {
    const relTokens = String(anchor?.rel || anchor?.getAttribute?.("rel") || "")
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .slice(0, 12);

    return {
      downloadAttribute: anchor?.hasAttribute?.("download") === true,
      downloadFileName: normalizeShortText(anchor?.getAttribute?.("download") || ""),
      relTokens,
      typeAttr: normalizeShortText(anchor?.getAttribute?.("type") || "").toLowerCase(),
      pingAttribute: Boolean(String(anchor?.getAttribute?.("ping") || "").trim()),
    };
  }

  function shouldUseBrowserDefaultForPreloadSafety(anchor, targetUrl) {
    return inspectAnchorSideEffectPreloadSafety(anchor, targetUrl).skipPreload === true;
  }

  function inspectAnchorSideEffectPreloadSafety(anchor, targetUrl) {
    const safety = collectAnchorPreloadSafety(anchor);
    const sideEffectReasons = [];

    if (safety.downloadAttribute === true) {
      sideEffectReasons.push("download-attribute");
    }

    if (hasUnsafePreloadMimeType(safety.typeAttr)) {
      sideEffectReasons.push("download-mime-type");
    }

    sideEffectReasons.push(...collectUnsafePreloadUrlReasons(targetUrl));

    const uniqueReasons = [...new Set(sideEffectReasons.filter(Boolean))];

    return {
      skipPreload: uniqueReasons.length > 0,
      sideEffectBlocked: uniqueReasons.length > 0,
      reason: uniqueReasons[0] || "",
      reasons: uniqueReasons,
      sideEffectReasons: uniqueReasons,
      preloadSafety: safety,
    };
  }

  function hasUnsafePreloadMimeType(typeAttr) {
    const normalizedType = String(typeAttr || "").trim().toLowerCase();

    return Boolean(
      normalizedType &&
        UNSAFE_PRELOAD_MIME_HINTS.some((mimeHint) => normalizedType.includes(mimeHint))
    );
  }

  function hasUnsafePreloadUrl(rawUrl) {
    return collectUnsafePreloadUrlReasons(rawUrl).length > 0;
  }

  function collectUnsafePreloadUrlReasons(rawUrl) {
    const reasons = [];

    try {
      const url = new URL(rawUrl, location.href);
      const pathSegments = url.pathname
        .split("/")
        .map((segment) => safeDecodeURIComponent(segment).trim().toLowerCase())
        .filter(Boolean);
      const extension = getPathExtension(pathSegments[pathSegments.length - 1] || "");

      if (extension && UNSAFE_PRELOAD_EXTENSIONS.has(extension)) {
        reasons.push("download-file-extension");
      }

      if (pathSegments.some((segment) => DOWNLOAD_PRELOAD_PATH_TOKENS.has(segment))) {
        reasons.push("download-url-path");
      }

      if (pathSegments.some((segment) => SIDE_EFFECT_PRELOAD_PATH_TOKENS.has(segment))) {
        reasons.push("side-effect-url-path");
      }

      for (const [key, value] of url.searchParams.entries()) {
        const normalizedKey = String(key || "").trim().toLowerCase();
        const normalizedValue = String(value || "").trim().toLowerCase();

        if (UNSAFE_PRELOAD_QUERY_KEYS.has(normalizedKey)) {
          reasons.push("download-query");
        }

        if (
          SIDE_EFFECT_PRELOAD_QUERY_VALUES.has(normalizedValue) ||
          (normalizedKey === "action" && SIDE_EFFECT_PRELOAD_QUERY_VALUES.has(normalizedValue)) ||
          (normalizedKey === "method" && SIDE_EFFECT_PRELOAD_QUERY_VALUES.has(normalizedValue))
        ) {
          reasons.push("side-effect-query");
        }

        if (normalizedValue.includes("attachment")) {
          reasons.push("download-query-attachment");
        }
      }
    } catch (_error) {
      reasons.push("invalid-url");
    }

    return [...new Set(reasons)];
  }

  function getPathExtension(fileName) {
    const normalizedName = String(fileName || "").split(/[?#]/u)[0];
    const dotIndex = normalizedName.lastIndexOf(".");

    if (dotIndex <= 0 || dotIndex === normalizedName.length - 1) {
      return "";
    }

    return normalizedName.slice(dotIndex + 1).toLowerCase();
  }

  function safeDecodeURIComponent(value) {
    try {
      return decodeURIComponent(value);
    } catch (_error) {
      return String(value || "");
    }
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
    collectAnchorPreloadSafety,
    inspectAnchorSideEffectPreloadSafety,
    shouldUseBrowserDefaultForPreloadSafety,
  });
})();
