function buildPageKeywordPrompt(input) {
  const pageUrl = typeof input?.pageUrl === "string" ? input.pageUrl : "";
  const title = typeof input?.title === "string" ? input.title : "";
  const textDigest = typeof input?.textDigest === "string" ? input.textDigest : "";
  const contentFingerprint =
    typeof input?.contentFingerprint === "string" ? input.contentFingerprint : "";

  return (
    [
      "You summarize a visited web page into concise Chinese keywords for browser prediction.",
      "Return strict JSON only with this schema:",
      "{\"keywords\":[{\"text\":\"...\",\"score\":0.0}],\"page_type\":\"...\"}",
      "Rules:",
      "- 4 to 8 keywords",
      "- each keyword must be short and specific",
      "- score range 0.0 to 1.0",
      "- page_type should be short and stable",
      "- no markdown",
      "- no explanation",
      "",
      `page_url: ${pageUrl}`,
      `title: ${title}`,
      `content_fingerprint: ${contentFingerprint}`,
      "text_digest:",
      textDigest,
    ].join("\n")
  );
}

function buildContextKeywordPrompt(input) {
  return (
    [
      "You infer the user's current browsing task from the active page, visible open tabs, and recent foreground pages.",
      "Return strict JSON only with this schema:",
      "{\"keywords\":[{\"text\":\"...\",\"score\":0.0}],\"page_type\":\"...\"}",
      "Rules:",
      "- output 4 to 8 task keywords",
      "- focus on likely next-page intent",
      "- score range 0.0 to 1.0",
      "- page_type should describe the current task category",
      "- no markdown",
      "- no explanation",
      "",
      `current_page: ${serializeAiPromptJson(input?.currentPage)}`,
      `open_pages: ${serializeAiPromptJson(input?.openPages ?? [])}`,
      `recent_foreground_pages: ${serializeAiPromptJson(input?.recentForegroundPages ?? [])}`,
      `history_page_pool: ${serializeAiPromptJson(input?.historyPagePool ?? [])}`,
    ].join("\n")
  );
}

function serializeAiPromptJson(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch (_error) {
    return "null";
  }
}
