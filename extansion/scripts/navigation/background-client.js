(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});

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

  async function registerPreloadCandidates(payload) {
    return await chrome.runtime.sendMessage({
      type: "preload:register-candidates",
      pageUrl: payload.pageUrl,
      pageTitle: payload.pageTitle,
      pageTextDigest: payload.pageTextDigest,
      contentFingerprint: payload.contentFingerprint,
      links: payload.links,
    });
  }

  async function reportPageDigestToBackground(payload) {
    await chrome.runtime.sendMessage({
      type: "ai:report-page-digest",
      pageUrl: payload.pageUrl,
      title: payload.title,
      textDigest: payload.textDigest,
      contentFingerprint: payload.contentFingerprint,
    });
  }

  Object.assign(namespace, {
    sendNavigationPrimeSource,
    sendNavigationLinkIntent,
    requestClickNavigationResolutionWithTimeout,
    registerPreloadCandidates,
    reportPageDigestToBackground,
  });
})();
