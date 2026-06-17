(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const {
    constants,
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

  function collectCandidateLinks() {
    if (shouldSkipSensitivePagePreload?.(location.href) === true) {
      return [];
    }

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

      const preloadSafetyDecision = inspectAnchorSideEffectPreloadSafety(anchor, targetUrl);

      if (preloadSafetyDecision.skipPreload === true) {
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
        preloadSafety: preloadSafetyDecision.preloadSafety ?? collectAnchorPreloadSafety(anchor),
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
    collectCandidateLinks,
    buildCandidateLinksSignature,
  });
})();
