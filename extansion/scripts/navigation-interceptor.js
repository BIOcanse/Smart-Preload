(function () {
  // Page-side edge adapter only. Avoid growing background-grade navigation
  // policy here; capture DOM signals and forward them to the background chain.
  const MAX_CANDIDATE_LINKS = 40;
  const MAX_TEXT_DIGEST_CHARS = 2200;
  const MAX_CANDIDATE_TEXT_CHARS = 240;
  const MAX_NEARBY_TEXT_CHARS = 320;
  const EARLY_LINK_RESCAN_DELAY_MS = 120;
  const LINK_STABILITY_POLL_MS = 120;
  const LINK_STABILITY_MAX_WAIT_MS = 900;
  const BLANK_CLICK_RESOLUTION_TIMEOUT_MS = 500;
  const CURRENT_TAB_CLICK_RESOLUTION_TIMEOUT_MS = 2500;
  const WATERFALL_BASELINE_MAX_UNLOCKED_MS = 2500;
  const RESCAN_DELAY_MS = 700;
  const PAGE_DIGEST_DELAY_MS = 1500;
  const SPECULATION_RULES_ELEMENT_ID = "zero-latency-speculation-rules";

  let lastLocationHref = location.href;
  let candidateScanTimerId = null;
  let candidateScanDueAt = 0;
  let candidateScanForce = false;
  let candidateScanInFlight = false;
  let candidateScanPending = false;
  let pageDigestTimerId = null;
  let observerStarted = false;
  let observerReadinessListenerStarted = false;
  let deferredScanWhileEditing = false;
  let deferredPageDigestWhileEditing = false;
  let lastSentCandidateSignature = null;
  let fixedCandidateUrlSet = null;
  let waterfallBaselineStartedAt = 0;
  let waterfallBaselineLocked = false;
  let ignoreWaterfallDynamicLinks = true;
  let lastReportedPageDigestFingerprint = null;
  document.addEventListener(
    "mousedown",
    (event) => {
      void primeSourcePageForNavigation(event);
    },
    true
  );

  document.addEventListener(
    "click",
    (event) => {
      void handleClick(event);
    },
    true
  );

  document.addEventListener(
    "auxclick",
    (event) => {
      void handleAuxClick(event);
    },
    true
  );

  document.addEventListener("DOMContentLoaded", () => {
    scheduleCandidateScan({
      delayMs: EARLY_LINK_RESCAN_DELAY_MS,
      force: true,
    });
    schedulePageDigestReport();
  });

  window.addEventListener("load", () => {
    scheduleCandidateScan({
      delayMs: RESCAN_DELAY_MS,
      force: true,
    });
    schedulePageDigestReport();
  });

  document.addEventListener("prerenderingchange", () => {
    if (isPassivePrerenderContext()) {
      return;
    }

    scheduleCandidateScan();
    schedulePageDigestReport();
  });

  document.addEventListener("focusin", () => {
    if (hasActiveEditableFocus()) {
      window.clearTimeout(candidateScanTimerId);
      candidateScanTimerId = null;
      candidateScanDueAt = 0;
      candidateScanForce = false;
      window.clearTimeout(pageDigestTimerId);
    }
  });

  document.addEventListener("focusout", () => {
    window.setTimeout(() => {
      if (deferredScanWhileEditing && !hasActiveEditableFocus()) {
        deferredScanWhileEditing = false;
        scheduleCandidateScan();
      }
      if (deferredPageDigestWhileEditing && !hasActiveEditableFocus()) {
        deferredPageDigestWhileEditing = false;
        schedulePageDigestReport();
      }
    }, 0);
  });

  const mutationObserver = new MutationObserver((mutations) => {
    if (mutations.every(isExtensionOnlyMutation)) {
      return;
    }

    if (location.href !== lastLocationHref) {
      lastLocationHref = location.href;
      lastSentCandidateSignature = null;
      fixedCandidateUrlSet = null;
      waterfallBaselineStartedAt = 0;
      waterfallBaselineLocked = false;
      schedulePageDigestReport();
    }

    scheduleCandidateScan({
      delayMs: EARLY_LINK_RESCAN_DELAY_MS,
    });
    schedulePageDigestReport();
  });

  startMutationObserverWhenReady();

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "preload:collect-candidates") {
      scheduleCandidateScan({
        delayMs: EARLY_LINK_RESCAN_DELAY_MS,
        force: true,
      });
      return;
    }

    if (message?.type === "preload:clear-speculation-rules") {
      applySpeculationRules({
        prerenderTargets: [],
        prefetchTargets: [],
      });
    }
  });

  function scheduleCandidateScan(options = {}) {
    if (hasActiveEditableFocus()) {
      deferredScanWhileEditing = true;
      return;
    }

    const delayMs = Math.max(0, Number(options.delayMs ?? RESCAN_DELAY_MS) || 0);
    const force = options.force === true;
    const nextDueAt = Date.now() + delayMs;

    if (candidateScanTimerId && candidateScanDueAt <= nextDueAt) {
      candidateScanForce = candidateScanForce || force;
      return;
    }

    deferredScanWhileEditing = false;
    window.clearTimeout(candidateScanTimerId);
    candidateScanDueAt = nextDueAt;
    candidateScanForce = force;
    candidateScanTimerId = window.setTimeout(() => {
      const shouldForce = candidateScanForce;
      candidateScanTimerId = null;
      candidateScanDueAt = 0;
      candidateScanForce = false;
      void sendCandidateLinks({ force: shouldForce });
    }, delayMs);
  }

  function schedulePageDigestReport() {
    if (hasActiveEditableFocus()) {
      deferredPageDigestWhileEditing = true;
      return;
    }

    deferredPageDigestWhileEditing = false;
    window.clearTimeout(pageDigestTimerId);
    pageDigestTimerId = window.setTimeout(() => {
      void reportPageDigest();
    }, PAGE_DIGEST_DELAY_MS);
  }

  function startMutationObserverWhenReady() {
    if (observerStarted) {
      return;
    }

    if (document.documentElement) {
      mutationObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["href", "target", "title", "aria-label", "alt"],
      });
      observerStarted = true;
      scheduleCandidateScan({
        delayMs: EARLY_LINK_RESCAN_DELAY_MS,
        force: true,
      });
      return;
    }

    if (observerReadinessListenerStarted) {
      return;
    }

    observerReadinessListenerStarted = true;
    document.addEventListener(
      "readystatechange",
      () => {
        startMutationObserverWhenReady();
      }
    );
  }

  async function sendCandidateLinks(options = {}) {
    if (candidateScanInFlight) {
      candidateScanPending = true;
      return;
    }

    candidateScanInFlight = true;

    try {
      await sendCandidateLinksNow(options);
    } finally {
      candidateScanInFlight = false;

      if (candidateScanPending) {
        candidateScanPending = false;
        scheduleCandidateScan({
          delayMs: EARLY_LINK_RESCAN_DELAY_MS,
        });
      }
    }
  }

  async function sendCandidateLinksNow(options = {}) {
    if (isPassivePrerenderContext()) {
      return;
    }

    if (hasActiveEditableFocus()) {
      deferredScanWhileEditing = true;
      return;
    }

    const candidateSnapshot = await collectStableCandidateLinkSnapshot();

    if (!candidateSnapshot) {
      return;
    }

    const { links, signature } = candidateSnapshot;

    if (signature === lastSentCandidateSignature && options.force !== true) {
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "preload:register-candidates",
        pageUrl: location.href,
        pageTitle: document.title || "",
        pageTextDigest: collectPageTextDigest(),
        contentFingerprint: buildPageContentFingerprint(),
        links,
      });
      syncContentScriptPreloadPolicy(response?.contentScriptPolicy);
      lastSentCandidateSignature = signature;

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

  function syncContentScriptPreloadPolicy(policy) {
    if (typeof policy?.ignoreWaterfallDynamicLinks === "boolean") {
      ignoreWaterfallDynamicLinks = policy.ignoreWaterfallDynamicLinks;
    }

    if (!ignoreWaterfallDynamicLinks) {
      fixedCandidateUrlSet = null;
      waterfallBaselineStartedAt = 0;
      waterfallBaselineLocked = false;
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

      if (Date.now() - startedAt >= LINK_STABILITY_MAX_WAIT_MS) {
        if (latestLinks.length === 0 && document.readyState === "loading") {
          return null;
        }

        return {
          links: latestLinks,
          signature: latestSignature,
        };
      }

      previousSignature = latestSignature;
      await sleep(LINK_STABILITY_POLL_MS);
    }
  }

  async function reportPageDigest() {
    if (isPassivePrerenderContext()) {
      return;
    }

    const nextPageDigestFingerprint = buildPageContentFingerprint();

    if (nextPageDigestFingerprint === lastReportedPageDigestFingerprint) {
      return;
    }

    try {
      await chrome.runtime.sendMessage({
        type: "ai:report-page-digest",
        pageUrl: location.href,
        title: document.title || "",
        textDigest: collectPageTextDigest(),
        contentFingerprint: nextPageDigestFingerprint,
      });
      lastReportedPageDigestFingerprint = nextPageDigestFingerprint;
    } catch (_error) {
      // Ignore transient background messaging failures.
    }
  }

  async function handleClick(event) {
    if (isPassivePrerenderContext()) {
      return;
    }

    const navigation = getTrackedAnchorNavigation(event);

    if (!navigation || event.defaultPrevented || event.button !== 0) {
      return;
    }

    const clickPlan = getPrimaryClickHandlingPlan(event, navigation);

    if (clickPlan.mode === "record-link-intent") {
      await sendNavigationLinkIntent(location.href, navigation.targetUrl, clickPlan.targetHint, {
        skipBehaviorLearning: clickPlan.skipBehaviorLearning === true,
        userOverride: clickPlan.userOverride === true,
      });
      return;
    }

    if (clickPlan.mode === "allow-browser-default") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const reservedWindow = clickPlan.reserveBlankWindow ? openReservedBlankWindow() : null;
    const resolutionTimeoutMs = reservedWindow
      ? BLANK_CLICK_RESOLUTION_TIMEOUT_MS
      : CURRENT_TAB_CLICK_RESOLUTION_TIMEOUT_MS;
    const resolutionExpiresAt = Date.now() + resolutionTimeoutMs;
    const resolution = await requestClickNavigationResolutionWithTimeout(
      {
        sourcePageUrl: location.href,
        targetUrl: navigation.targetUrl,
        targetHint: clickPlan.targetHint,
        resolutionExpiresAt,
      },
      resolutionTimeoutMs
    );

    executeNavigationResolution(resolution, {
      targetUrl: navigation.targetUrl,
      targetHint: clickPlan.targetHint,
      reservedWindow,
    });
  }

  async function handleAuxClick(event) {
    if (isPassivePrerenderContext()) {
      return;
    }

    if (event.button !== 1) {
      return;
    }

    const navigation = getTrackedAnchorNavigation(event);

    if (!navigation || event.defaultPrevented) {
      return;
    }

    await sendNavigationLinkIntent(location.href, navigation.targetUrl, "_blank", {
      skipBehaviorLearning: true,
      userOverride: true,
    });
  }

  async function primeSourcePageForNavigation(event) {
    if (isPassivePrerenderContext()) {
      return;
    }

    if (event.button === 2) {
      return;
    }

    if (!getTrackedAnchorNavigation(event)) {
      return;
    }

    await sendNavigationPrimeSource(location.href);
  }

  async function sendNavigationPrimeSource(pageUrl) {
    try {
      await chrome.runtime.sendMessage({
        type: "navigation:prime-source-page",
        pageUrl,
      });
    } catch (_error) {
      // Ignore transient background messaging failures.
    }
  }

  async function sendNavigationLinkIntent(sourcePageUrl, targetUrl, targetHint, options = {}) {
    try {
      await chrome.runtime.sendMessage({
        type: "navigation:record-link-intent",
        sourcePageUrl,
        targetUrl,
        targetHint: targetHint === "_blank" ? "_blank" : "_self",
        skipBehaviorLearning: options?.skipBehaviorLearning === true,
        userOverride: options?.userOverride === true,
      });
    } catch (_error) {
      // Ignore transient background messaging failures.
    }
  }

  async function requestClickNavigationResolution(payload) {
    try {
      return await chrome.runtime.sendMessage({
        type: "navigation:resolve-click",
        sourcePageUrl: payload?.sourcePageUrl || location.href,
        targetUrl: payload?.targetUrl || "",
        targetHint: payload?.targetHint === "_blank" ? "_blank" : "_self",
        resolutionExpiresAt: Number.isFinite(payload?.resolutionExpiresAt)
          ? payload.resolutionExpiresAt
          : null,
      });
    } catch (_error) {
      return {
        handled: false,
        action: "skip",
      };
    }
  }

  async function requestClickNavigationResolutionWithTimeout(payload, timeoutMs) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return requestClickNavigationResolution(payload);
    }

    return Promise.race([
      requestClickNavigationResolution(payload),
      new Promise((resolve) => {
        window.setTimeout(() => {
          resolve({
            handled: false,
            action:
              payload?.targetHint === "_blank" ? "navigate-reserved-tab" : "navigate-current-tab",
            timedOut: true,
          });
        }, timeoutMs);
      }),
    ]);
  }

  function getPrimaryClickHandlingPlan(event, navigation) {
    const modifierManagedClick = isModifierManagedNewTabClick(event);

    if (modifierManagedClick) {
      return {
        mode: "record-link-intent",
        targetHint: "_blank",
        reserveBlankWindow: false,
        skipBehaviorLearning: true,
        userOverride: true,
      };
    }

    if (event.altKey) {
      return {
        mode: "allow-browser-default",
        targetHint: navigation.rawNavigationTarget,
        reserveBlankWindow: false,
      };
    }

    if (isGoogleSearchInternalModeNavigation(location.href, navigation.targetUrl)) {
      return {
        mode: "allow-browser-default",
        targetHint: navigation.rawNavigationTarget,
        reserveBlankWindow: false,
      };
    }

    return {
      mode: "resolve-in-background",
      targetHint: navigation.navigationTarget,
      reserveBlankWindow: navigation.navigationTarget === "_blank",
    };
  }

  function isModifierManagedNewTabClick(event) {
    return event.metaKey || event.ctrlKey || event.shiftKey;
  }

  function executeNavigationResolution(resolution, { targetUrl, targetHint, reservedWindow }) {
    if (resolution?.handled === true) {
      reservedWindow?.close();
      return;
    }

    switch (resolution?.action) {
      case "navigate-current-tab":
        navigateWithoutPreload(targetUrl, "_self");
        return;
      case "navigate-reserved-tab":
        navigateWithReservedWindow(reservedWindow, targetUrl, "_blank");
        return;
      case "allow-browser-default":
        reservedWindow?.close();
        navigateWithoutPreload(targetUrl, targetHint);
        return;
      default:
        reservedWindow?.close();
        navigateWithoutPreload(targetUrl, targetHint);
        return;
    }
  }

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

    return {
      anchor,
      targetUrl,
      rawNavigationTarget,
      navigationTarget,
    };
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

      if (links.length >= MAX_CANDIDATE_LINKS) {
        break;
      }
    }

    return links;
  }

  function filterWaterfallDynamicLinks(links) {
    if (!ignoreWaterfallDynamicLinks) {
      return links;
    }

    if (links.length === 0) {
      return links;
    }

    if (!fixedCandidateUrlSet) {
      fixedCandidateUrlSet = new Set();
      waterfallBaselineStartedAt = Date.now();
    }

    if (!waterfallBaselineLocked) {
      for (const link of links) {
        if (link?.url) {
          fixedCandidateUrlSet.add(link.url);
        }
      }

      if (shouldLockWaterfallBaseline()) {
        waterfallBaselineLocked = true;
      }

      return links;
    }

    return links.filter((link) => fixedCandidateUrlSet.has(link.url));
  }

  function shouldLockWaterfallBaseline() {
    if (!fixedCandidateUrlSet || fixedCandidateUrlSet.size === 0) {
      return false;
    }

    return (
      document.readyState !== "loading" ||
      Date.now() - waterfallBaselineStartedAt >= WATERFALL_BASELINE_MAX_UNLOCKED_MS
    );
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

  function collectPageTextDigest() {
    const title = (document.title || "").trim();
    const bodyText = (document.body?.innerText || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TEXT_DIGEST_CHARS);

    return [title, bodyText].filter(Boolean).join("\n\n");
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
    });
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
      return containerText.slice(0, MAX_NEARBY_TEXT_CHARS);
    }

    return containerText
      .replace(anchorText, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_NEARBY_TEXT_CHARS);
  }

  function collectAnchorImageAlt(anchor) {
    const imageAlt = anchor?.querySelector?.("img[alt]")?.getAttribute?.("alt") || "";
    return normalizeShortText(imageAlt);
  }

  function normalizeShortText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_CANDIDATE_TEXT_CHARS);
  }

  function normalizeLongText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_NEARBY_TEXT_CHARS);
  }

  function buildPageContentFingerprint() {
    const sourceText = `${location.href}|${document.title || ""}|${collectPageTextDigest().slice(0, 800)}`;
    let hash = 2166136261;

    for (let index = 0; index < sourceText.length; index += 1) {
      hash ^= sourceText.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return `fp-${(hash >>> 0).toString(16)}`;
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

  function navigateWithoutPreload(targetUrl, navigationTarget) {
    if (navigationTarget === "_blank") {
      window.open(targetUrl, "_blank", "noopener");
      return;
    }

    location.assign(targetUrl);
  }

  function navigateWithReservedWindow(reservedWindow, targetUrl, navigationTarget) {
    if (navigationTarget !== "_blank") {
      navigateWithoutPreload(targetUrl, navigationTarget);
      return;
    }

    if (reservedWindow && !reservedWindow.closed) {
      reservedWindow.location.replace(targetUrl);
      return;
    }

    navigateWithoutPreload(targetUrl, navigationTarget);
  }

  function openReservedBlankWindow() {
    const reservedWindow = window.open("about:blank", "_blank");

    if (!reservedWindow) {
      return null;
    }

    try {
      reservedWindow.opener = null;
    } catch (_error) {
      // Ignore browsers that block reassigning opener.
    }

    return reservedWindow;
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

  function applySpeculationRules({ prerenderTargets = [], prefetchTargets = [] }) {
    const speculationRulesElement = document.getElementById(SPECULATION_RULES_ELEMENT_ID);
    const serializedRules = buildSpeculationRulesPayload({
      prerenderTargets,
      prefetchTargets,
    });

    if (!serializedRules) {
      speculationRulesElement?.remove();
      return;
    }

    if (
      !HTMLScriptElement.supports ||
      !HTMLScriptElement.supports("speculationrules")
    ) {
      speculationRulesElement?.remove();
      return;
    }

    if (speculationRulesElement?.textContent === serializedRules) {
      return;
    }

    const nextRulesElement =
      speculationRulesElement instanceof HTMLScriptElement
        ? speculationRulesElement
        : document.createElement("script");
    nextRulesElement.id = SPECULATION_RULES_ELEMENT_ID;
    nextRulesElement.type = "speculationrules";
    nextRulesElement.textContent = serializedRules;
    (document.head || document.documentElement || document.body)?.appendChild(nextRulesElement);
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

  function isExtensionOnlyMutation(mutation) {
    const target = mutation.target;

    if (target instanceof Element && target.id === SPECULATION_RULES_ELEMENT_ID) {
      return true;
    }

    if (mutation.type !== "childList") {
      return false;
    }

    const touchedNodes = [...mutation.addedNodes, ...mutation.removedNodes];

    if (!touchedNodes.length) {
      return false;
    }

    return touchedNodes.every(
      (node) => node instanceof Element && node.id === SPECULATION_RULES_ELEMENT_ID
    );
  }

  function buildSpeculationRulesPayload({ prerenderTargets, prefetchTargets }) {
    const selfUrls = [];
    const blankUrls = [];
    const prefetchUrls = [];
    const seen = new Set();

    for (const target of Array.isArray(prerenderTargets) ? prerenderTargets : []) {
      const normalizedUrl = normalizeNavigableHref(target?.url);
      const normalizedTargetHint =
        target?.targetHint === "_blank" ? "_blank" : "_self";

      if (!normalizedUrl || seen.has(`${normalizedTargetHint}|${normalizedUrl}`)) {
        continue;
      }

      seen.add(`${normalizedTargetHint}|${normalizedUrl}`);

      if (normalizedTargetHint === "_blank") {
        blankUrls.push(normalizedUrl);
      } else {
        selfUrls.push(normalizedUrl);
      }
    }

    for (const target of Array.isArray(prefetchTargets) ? prefetchTargets : []) {
      const normalizedUrl = normalizeNavigableHref(target?.url);

      if (!normalizedUrl || seen.has(`prefetch|${normalizedUrl}`)) {
        continue;
      }

      seen.add(`prefetch|${normalizedUrl}`);
      prefetchUrls.push(normalizedUrl);
    }

    const prerenderRules = [];

    if (selfUrls.length) {
      prerenderRules.push({ urls: selfUrls });
    }

    if (blankUrls.length) {
      prerenderRules.push({
        urls: blankUrls,
        target_hint: "_blank",
      });
    }

    const payload = {};

    if (prerenderRules.length) {
      payload.prerender = prerenderRules;
    }

    if (prefetchUrls.length) {
      payload.prefetch = [{ urls: prefetchUrls }];
    }

    return Object.keys(payload).length ? JSON.stringify(payload) : null;
  }

  function isPassivePrerenderContext() {
    return document.prerendering === true;
  }
})();
