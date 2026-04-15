(function () {
  const MAX_CANDIDATE_LINKS = 40;
  const RESCAN_DELAY_MS = 700;
  const SPECULATION_RULES_ELEMENT_ID = "zero-latency-speculation-rules";

  let lastLocationHref = location.href;
  let rescanTimerId = null;
  let observerStarted = false;
  let runtimeFlags = {
    crossSiteCurrentTabSwapEnabled: false,
  };

  document.addEventListener(
    "click",
    (event) => {
      void handleClick(event);
    },
    true
  );

  document.addEventListener("DOMContentLoaded", () => {
    scheduleCandidateScan();
  });

  window.addEventListener("load", () => {
    scheduleCandidateScan();
  });

  const mutationObserver = new MutationObserver(() => {
    if (location.href !== lastLocationHref) {
      lastLocationHref = location.href;
    }

    scheduleCandidateScan();
  });

  startMutationObserverWhenReady();

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "preload:collect-candidates") {
      scheduleCandidateScan();
    }
  });

  function scheduleCandidateScan() {
    window.clearTimeout(rescanTimerId);
    rescanTimerId = window.setTimeout(() => {
      void sendCandidateLinks();
    }, RESCAN_DELAY_MS);
  }

  function startMutationObserverWhenReady() {
    if (observerStarted) {
      return;
    }

    if (document.documentElement) {
      mutationObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["href"],
      });
      observerStarted = true;
      return;
    }

    document.addEventListener(
      "readystatechange",
      () => {
        startMutationObserverWhenReady();
      },
      { once: true }
    );
  }

  async function sendCandidateLinks() {
    const links = collectCandidateLinks();

    try {
      const response = await chrome.runtime.sendMessage({
        type: "preload:register-candidates",
        pageUrl: location.href,
        links,
      });

      runtimeFlags.crossSiteCurrentTabSwapEnabled =
        response?.crossSiteCurrentTabSwapEnabled === true;
      applySpeculationRules({
        prerenderTargets: response?.prerenderTargets ?? [],
        prefetchTargets: response?.prefetchTargets ?? [],
      });
    } catch (error) {
      runtimeFlags.crossSiteCurrentTabSwapEnabled = false;
      applySpeculationRules({
        prerenderTargets: [],
        prefetchTargets: [],
      });
      console.debug("Failed to register preload candidates.", error);
    }
  }

  async function handleClick(event) {
    if (!shouldInterceptLeftClick(event)) {
      return;
    }

    const anchor = event
      .composedPath()
      .find((node) => node instanceof HTMLAnchorElement && node.href);

    if (!(anchor instanceof HTMLAnchorElement)) {
      return;
    }

    const targetUrl = normalizeNavigableHref(anchor.href);
    const navigationTarget = getAnchorNavigationTarget(anchor);

    if (!targetUrl || !navigationTarget) {
      return;
    }

    if (isSameOriginNavigation(targetUrl)) {
      return;
    }

    if (navigationTarget !== "_blank" && !runtimeFlags.crossSiteCurrentTabSwapEnabled) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    try {
      const response = await chrome.runtime.sendMessage({
        type: "preload:activate-if-ready",
        url: targetUrl,
        openInNewTab: navigationTarget === "_blank",
      });

      if (!response?.handled) {
        navigateWithoutPreload(targetUrl, navigationTarget);
      }
    } catch (_error) {
      navigateWithoutPreload(targetUrl, navigationTarget);
    }
  }

  function collectCandidateLinks() {
    const seen = new Set();
    const links = [];
    const anchors = document.querySelectorAll("a[href]");

    for (const anchor of anchors) {
      const targetUrl = normalizeNavigableHref(anchor.href);
      const targetHint = getAnchorNavigationTarget(anchor);

      if (!targetUrl || !targetHint || seen.has(targetUrl)) {
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
      });

      if (links.length >= MAX_CANDIDATE_LINKS) {
        break;
      }
    }

    return links;
  }

  function shouldInterceptLeftClick(event) {
    if (event.defaultPrevented || event.button !== 0) {
      return false;
    }

    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return false;
    }

    const anchor = event
      .composedPath()
      .find((node) => node instanceof HTMLAnchorElement && node.href);

    if (!(anchor instanceof HTMLAnchorElement)) {
      return false;
    }

    if (!getAnchorNavigationTarget(anchor)) {
      return false;
    }

    if (anchor.hasAttribute("download")) {
      return false;
    }

    return normalizeNavigableHref(anchor.href) !== null;
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

  function isSameOriginNavigation(targetUrl) {
    try {
      return new URL(targetUrl, location.href).origin === location.origin;
    } catch (_error) {
      return false;
    }
  }

  function navigateWithoutPreload(targetUrl, navigationTarget) {
    if (navigationTarget === "_blank") {
      window.open(targetUrl, "_blank", "noopener");
      return;
    }

    location.assign(targetUrl);
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
})();
