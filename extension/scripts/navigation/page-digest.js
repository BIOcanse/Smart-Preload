(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const {
    constants,
    state,
    reportPageDigestToBackground,
    isPassivePrerenderContext,
    capturePageGenerationToken,
    isPageGenerationTokenCurrent,
  } = namespace;

  async function reportPageDigest(options = {}) {
    if (isPassivePrerenderContext()) {
      return;
    }

    const pageToken = options.pageToken ?? capturePageGenerationToken();

    if (!isPageGenerationTokenCurrent(pageToken)) {
      return;
    }

    const pageSnapshot = options.pageSnapshot ?? collectPageContentSnapshot();
    const nextPageDigestFingerprint = pageSnapshot.contentFingerprint;

    if (nextPageDigestFingerprint === state.lastReportedPageDigestFingerprint) {
      return;
    }

    try {
      await reportPageDigestToBackground({
        pageUrl: pageSnapshot.pageUrl,
        title: pageSnapshot.title,
        textDigest: pageSnapshot.textDigest,
        contentFingerprint: nextPageDigestFingerprint,
        attentionActivity: namespace.buildAttentionActivitySnapshot?.() ?? null,
      });

      if (isPageGenerationTokenCurrent(pageToken)) {
        state.lastReportedPageDigestFingerprint = nextPageDigestFingerprint;
      }
    } catch (_error) {
      // Ignore transient background messaging failures.
    }
  }

  function collectPageTextDigest() {
    return collectPageContentSnapshot().textDigest;
  }

  function buildPageContentFingerprint() {
    return collectPageContentSnapshot().contentFingerprint;
  }

  function collectPageContentSnapshot() {
    const pageUrl = state.currentPageUrl || location.href;
    const title = (document.title || "").trim();
    const cachedSnapshot = state.cachedPageContentSnapshot;

    if (
      cachedSnapshot?.pageGeneration === state.pageGeneration &&
      cachedSnapshot?.documentContentRevision === state.documentContentRevision &&
      cachedSnapshot?.pageUrl === pageUrl &&
      cachedSnapshot?.title === title
    ) {
      return cachedSnapshot;
    }

    const bodyText = (document.body?.innerText || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, constants.MAX_TEXT_DIGEST_CHARS);
    const textDigest = [title, bodyText].filter(Boolean).join("\n\n");
    const sourceText = `${pageUrl}|${title}|${textDigest.slice(0, 800)}`;
    let hash = 2166136261;

    for (let index = 0; index < sourceText.length; index += 1) {
      hash ^= sourceText.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    state.cachedPageContentSnapshot = {
      pageGeneration: state.pageGeneration,
      documentContentRevision: state.documentContentRevision,
      pageUrl,
      title,
      textDigest,
      contentFingerprint: `fp-${(hash >>> 0).toString(16)}`,
    };
    return state.cachedPageContentSnapshot;
  }

  Object.assign(namespace, {
    reportPageDigest,
    collectPageContentSnapshot,
    collectPageTextDigest,
    buildPageContentFingerprint,
  });
})();
