(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const { constants, state, reportPageDigestToBackground, isPassivePrerenderContext } = namespace;

  async function reportPageDigest() {
    if (isPassivePrerenderContext()) {
      return;
    }

    const nextPageDigestFingerprint = buildPageContentFingerprint();

    if (nextPageDigestFingerprint === state.lastReportedPageDigestFingerprint) {
      return;
    }

    try {
      await reportPageDigestToBackground({
        pageUrl: location.href,
        title: document.title || "",
        textDigest: collectPageTextDigest(),
        contentFingerprint: nextPageDigestFingerprint,
      });
      state.lastReportedPageDigestFingerprint = nextPageDigestFingerprint;
    } catch (_error) {
      // Ignore transient background messaging failures.
    }
  }

  function collectPageTextDigest() {
    const title = (document.title || "").trim();
    const bodyText = (document.body?.innerText || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, constants.MAX_TEXT_DIGEST_CHARS);

    return [title, bodyText].filter(Boolean).join("\n\n");
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

  Object.assign(namespace, {
    reportPageDigest,
    collectPageTextDigest,
    buildPageContentFingerprint,
  });
})();
