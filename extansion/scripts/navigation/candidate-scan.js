(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const {
    constants,
    state,
    sleep,
    normalizeShortText,
    normalizeLongText,
    normalizeNavigableHref,
    getAnchorNavigationTarget,
    resolveManagedNavigationTarget,
    isGoogleSearchInternalModeNavigation,
    hasActiveEditableFocus,
    isPassivePrerenderContext,
    filterWaterfallDynamicLinks,
    registerPreloadCandidates,
    syncContentScriptPreloadPolicy,
    applySpeculationRules,
    collectPageTextDigest,
    buildPageContentFingerprint,
  } = namespace;

  async function sendCandidateLinks(options = {}) {
    if (state.candidateScanInFlight) {
      state.candidateScanPending = true;
      return;
    }

    state.candidateScanInFlight = true;

    try {
      await sendCandidateLinksNow(options);
    } finally {
      state.candidateScanInFlight = false;

      if (state.candidateScanPending) {
        state.candidateScanPending = false;
        namespace.scheduleCandidateScan?.({
          delayMs: constants.EARLY_LINK_RESCAN_DELAY_MS,
        });
      }
    }
  }

  async function sendCandidateLinksNow(options = {}) {
    if (isPassivePrerenderContext()) {
      return;
    }

    if (hasActiveEditableFocus()) {
      state.deferredScanWhileEditing = true;
      return;
    }

    const candidateSnapshot = await collectStableCandidateLinkSnapshot();

    if (!candidateSnapshot) {
      return;
    }

    const { links, signature } = candidateSnapshot;

    if (signature === state.lastSentCandidateSignature && options.force !== true) {
      return;
    }

    try {
      const response = await registerPreloadCandidates({
        pageUrl: location.href,
        pageTitle: document.title || "",
        pageTextDigest: collectPageTextDigest(),
        contentFingerprint: buildPageContentFingerprint(),
        links,
      });
      syncContentScriptPreloadPolicy(response?.contentScriptPolicy);
      state.lastSentCandidateSignature = signature;

      applySpeculationRules({
        prerenderTargets: response?.prerenderTargets ?? [],
        prefetchTargets: response?.prefetchTargets ?? [],
      });
    } catch (error) {
      applySpeculationRules({
        prerenderTargets: [],
        prefetchTargets: [],
      });
      console.debug("Failed to register preload candidates.", error);
    }
  }

  async function collectStableCandidateLinkSnapshot() {
    const startedAt = Date.now();
    let previousSignature = null;
    let latestLinks = [];
    let latestSignature = "";

    while (true) {
      if (isPassivePrerenderContext() || hasActiveEditableFocus()) {
        return null;
      }

      latestLinks = filterWaterfallDynamicLinks(collectCandidateLinks());
      latestSignature = buildCandidateLinksSignature(latestLinks);

      if (previousSignature === latestSignature) {
        if (latestLinks.length > 0 || document.readyState !== "loading") {
          return {
            links: latestLinks,
            signature: latestSignature,
          };
        }

        return null;
      }

      if (Date.now() - startedAt >= constants.LINK_STABILITY_MAX_WAIT_MS) {
        if (latestLinks.length === 0 && document.readyState === "loading") {
          return null;
        }

        return {
          links: latestLinks,
          signature: latestSignature,
        };
      }

      previousSignature = latestSignature;
      await sleep(constants.LINK_STABILITY_POLL_MS);
    }
  }

  function collectCandidateLinks() {
    const seen = new Set();
    const links = [];
    const anchors = document.querySelectorAll("a[href]");

    for (const anchor of anchors) {
      const targetUrl = normalizeNavigableHref(anchor.href);
      const targetHint = resolveManagedNavigationTarget(
        location.href,
        targetUrl,
        getAnchorNavigationTarget(anchor)
      );

      if (
        !targetUrl ||
        !targetHint ||
        seen.has(targetUrl) ||
        isGoogleSearchInternalModeNavigation(location.href, targetUrl)
      ) {
        continue;
      }

      const visibility = getVisibilityScore(anchor);

      if (visibility <= 0) {
        continue;
      }

      seen.add(targetUrl);
      links.push({
        url: targetUrl,
        targetHint,
        visibility,
        anchorText: collectAnchorText(anchor),
        nearbyText: collectNearbyText(anchor),
        titleAttr: normalizeShortText(anchor.getAttribute("title")),
        ariaLabel: normalizeShortText(anchor.getAttribute("aria-label")),
        imageAlt: collectAnchorImageAlt(anchor),
      });

      if (links.length >= constants.MAX_CANDIDATE_LINKS) {
        break;
      }
    }

    return links;
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
    const rect = anchor.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return 0;
    }

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const horizontallyVisible = rect.right > 0 && rect.left < viewportWidth;
    const verticallyVisible = rect.bottom > 0 && rect.top < viewportHeight;

    if (!horizontallyVisible || !verticallyVisible) {
      return 0;
    }

    const style = window.getComputedStyle(anchor);

    if (style.visibility === "hidden" || style.display === "none") {
      return 0;
    }

    return Math.max(1, Math.round(1000 - Math.max(rect.top, 0)));
  }

  Object.assign(namespace, {
    sendCandidateLinks,
    collectCandidateLinks,
    buildCandidateLinksSignature,
  });
})();
