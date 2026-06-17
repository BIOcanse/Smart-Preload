function parseAiKeywordInferenceResponse(outputText) {
  const rawText = typeof outputText === "string" ? outputText.trim() : "";

  if (!rawText) {
    return {
      keywords: [],
      pageType: null,
    };
  }

  let parsed;

  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(
      `AI keyword response was not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const rawKeywords = Array.isArray(parsed?.keywords) ? parsed.keywords : [];
  const keywords = rawKeywords
    .map((keyword) => normalizeAiKeyword(keyword))
    .filter(Boolean)
    .slice(0, MAX_AI_KEYWORD_COUNT);
  const pageType =
    typeof parsed?.page_type === "string" && parsed.page_type.trim()
      ? parsed.page_type.trim()
      : null;

  return {
    keywords,
    pageType,
  };
}

function normalizeAiKeyword(keyword) {
  const text = typeof keyword?.text === "string" ? keyword.text.trim() : "";

  if (!text) {
    return null;
  }

  return {
    text,
    score: clampAiKeywordScore(keyword?.score),
  };
}

function clampAiKeywordScore(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, Math.min(1, numericValue));
}

function buildHistoryPagePoolRecords(historyPagePool) {
  const titles = Array.isArray(historyPagePool?.titles) ? historyPagePool.titles : [];
  const urls = Array.isArray(historyPagePool?.urls) ? historyPagePool.urls : [];
  const texts = Array.isArray(historyPagePool?.texts) ? historyPagePool.texts : [];
  const maxLength = Math.max(titles.length, urls.length, texts.length);
  const records = [];

  for (let index = 0; index < maxLength; index += 1) {
    const pageUrl = typeof urls[index] === "string" ? urls[index].trim() : "";

    if (!pageUrl) {
      continue;
    }

    records.push({
      pageUrl,
      title: typeof titles[index] === "string" ? titles[index] : "",
      textDigest: typeof texts[index] === "string" ? texts[index] : "",
    });

    if (records.length >= MAX_HISTORY_PAGE_POOL_RECORDS) {
      break;
    }
  }

  return records;
}
