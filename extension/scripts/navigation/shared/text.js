(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const { constants } = namespace;

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

  Object.assign(namespace, {
    normalizeShortText,
    normalizeLongText,
  });
})();
