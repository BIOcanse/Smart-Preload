const MAX_AI_KEYWORD_COUNT = 8;
const MAX_HISTORY_PAGE_POOL_RECORDS = 5;
const KEYWORD_MATCH_MULTIPLIERS = {
  none: 1,
  weak: 2.2,
  medium: 3.6,
  strong: 5.4,
};
const KEYWORD_FIELD_WEIGHTS = {
  anchorText: 1,
  nearbyText: 0.75,
  titleAttr: 0.8,
  ariaLabel: 0.8,
  imageAlt: 0.55,
  hrefPathTokens: 0.45,
  targetKeyword: 1,
  targetTitle: 0.65,
  targetPageType: 0.5,
};

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

function serializeAiPromptJson(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch (_error) {
    return "null";
  }
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

function buildAiKeywordMatchResult({
  interestKeywords,
  candidate,
  targetPageKeywordEntry,
}) {
  const fieldEntries = buildCandidateSemanticFieldEntries(candidate, targetPageKeywordEntry);

  return buildKeywordMatchResultFromFieldEntries({
    interestKeywords,
    fieldEntries,
  });
}

function buildSiteAiKeywordMatchResult({
  interestKeywords,
  siteCandidates,
  targetPageKeywordsByUrl,
}) {
  const fieldEntries = buildSiteSemanticFieldEntries(siteCandidates, targetPageKeywordsByUrl);

  return buildKeywordMatchResultFromFieldEntries({
    interestKeywords,
    fieldEntries,
  });
}

function buildKeywordMatchResultFromFieldEntries({
  interestKeywords,
  fieldEntries,
}) {
  const normalizedInterestKeywords = Array.isArray(interestKeywords)
    ? interestKeywords.filter((keyword) => keyword && typeof keyword.text === "string")
    : [];
  const contributions = [];

  for (const interestKeyword of normalizedInterestKeywords) {
    const interestKeywordText = normalizeKeywordMatchText(interestKeyword.text);

    if (!interestKeywordText) {
      continue;
    }

    let strongestMatch = null;

    for (const fieldEntry of fieldEntries) {
      const matchContribution = computeKeywordFieldContribution(
        interestKeyword,
        interestKeywordText,
        fieldEntry
      );

      if (!matchContribution) {
        continue;
      }

      if (!strongestMatch || matchContribution.contribution > strongestMatch.contribution) {
        strongestMatch = matchContribution;
      }
    }

    if (strongestMatch) {
      contributions.push(strongestMatch);
    }
  }

  contributions.sort((left, right) => right.contribution - left.contribution);
  const strongestContributions = contributions.slice(0, 3);
  const matchStrength = strongestContributions.reduce(
    (sum, contribution) => sum + contribution.contribution,
    0
  );
  const matchTier = resolveKeywordMatchTier(matchStrength);

  return {
    matchStrength,
    matchTier,
    multiplier: KEYWORD_MATCH_MULTIPLIERS[matchTier] ?? 1,
    matchedKeywords: strongestContributions.map((contribution) => ({
      interestKeyword: contribution.interestKeyword,
      field: contribution.field,
      contribution: contribution.contribution,
      matchedText: contribution.matchedText,
    })),
  };
}

function buildCandidateSemanticFieldEntries(candidate, targetPageKeywordEntry) {
  const fieldEntries = [];

  pushSemanticField(fieldEntries, "anchorText", candidate?.anchorText, KEYWORD_FIELD_WEIGHTS.anchorText);
  pushSemanticField(fieldEntries, "nearbyText", candidate?.nearbyText, KEYWORD_FIELD_WEIGHTS.nearbyText);
  pushSemanticField(fieldEntries, "titleAttr", candidate?.titleAttr, KEYWORD_FIELD_WEIGHTS.titleAttr);
  pushSemanticField(fieldEntries, "ariaLabel", candidate?.ariaLabel, KEYWORD_FIELD_WEIGHTS.ariaLabel);
  pushSemanticField(fieldEntries, "imageAlt", candidate?.imageAlt, KEYWORD_FIELD_WEIGHTS.imageAlt);

  if (Array.isArray(candidate?.hrefPathTokens) && candidate.hrefPathTokens.length > 0) {
    pushSemanticField(
      fieldEntries,
      "hrefPathTokens",
      candidate.hrefPathTokens.join(" "),
      KEYWORD_FIELD_WEIGHTS.hrefPathTokens
    );
  }

  if (targetPageKeywordEntry) {
    for (const keyword of targetPageKeywordEntry.keywords ?? []) {
      if (!keyword?.text) {
        continue;
      }

      fieldEntries.push({
        field: "targetKeyword",
        text: normalizeKeywordMatchText(keyword.text),
        weight: KEYWORD_FIELD_WEIGHTS.targetKeyword * clampAiKeywordScore(keyword.score),
      });
    }

    pushSemanticField(
      fieldEntries,
      "targetTitle",
      targetPageKeywordEntry.title,
      KEYWORD_FIELD_WEIGHTS.targetTitle
    );
    pushSemanticField(
      fieldEntries,
      "targetPageType",
      targetPageKeywordEntry.pageType,
      KEYWORD_FIELD_WEIGHTS.targetPageType
    );
  }

  return fieldEntries;
}

function buildSiteSemanticFieldEntries(siteCandidates, targetPageKeywordsByUrl) {
  const normalizedSiteCandidates = Array.isArray(siteCandidates) ? siteCandidates : [];
  const aggregate = createSiteSemanticAggregate();

  for (const candidate of normalizedSiteCandidates) {
    collectSiteCandidateSemanticFields(aggregate, candidate, targetPageKeywordsByUrl);
  }

  return buildSiteSemanticFieldEntriesFromAggregate(aggregate);
}

function createSiteSemanticAggregate() {
  return {
    linkFields: {
      anchorText: new Set(),
      nearbyText: new Set(),
      titleAttr: new Set(),
      ariaLabel: new Set(),
      imageAlt: new Set(),
      hrefPathTokens: new Set(),
    },
    targetKeywordWeights: new Map(),
    targetTitles: new Set(),
    targetPageTypes: new Set(),
  };
}

function collectSiteCandidateSemanticFields(aggregate, candidate, targetPageKeywordsByUrl) {
  collectSiteCandidateLinkFields(aggregate.linkFields, candidate);
  collectSiteCandidateTargetFields(aggregate, candidate, targetPageKeywordsByUrl);
}

function collectSiteCandidateLinkFields(aggregateLinkFields, candidate) {
  collectSiteFieldTexts(aggregateLinkFields.anchorText, candidate?.anchorText);
  collectSiteFieldTexts(aggregateLinkFields.nearbyText, candidate?.nearbyText);
  collectSiteFieldTexts(aggregateLinkFields.titleAttr, candidate?.titleAttr);
  collectSiteFieldTexts(aggregateLinkFields.ariaLabel, candidate?.ariaLabel);
  collectSiteFieldTexts(aggregateLinkFields.imageAlt, candidate?.imageAlt);

  if (!Array.isArray(candidate?.hrefPathTokens)) {
    return;
  }

  for (const token of candidate.hrefPathTokens) {
    const normalizedToken = normalizeKeywordMatchText(token);

    if (normalizedToken) {
      aggregateLinkFields.hrefPathTokens.add(normalizedToken);
    }
  }
}

function collectSiteCandidateTargetFields(aggregate, candidate, targetPageKeywordsByUrl) {
  const targetPageUrl = normalizeKeywordMatchText(candidate?.targetPageUrl || candidate?.url || "");
  const pageKeywordEntry = resolveTargetPageKeywordEntryForCandidate(
    candidate,
    targetPageKeywordsByUrl
  );

  if (!pageKeywordEntry && !targetPageUrl) {
    return;
  }

  collectTargetKeywordWeights(aggregate.targetKeywordWeights, pageKeywordEntry);
  collectSiteFieldTexts(aggregate.targetTitles, pageKeywordEntry?.title);
  collectSiteFieldTexts(aggregate.targetPageTypes, pageKeywordEntry?.pageType);
}

function resolveTargetPageKeywordEntryForCandidate(candidate, targetPageKeywordsByUrl) {
  return (
    targetPageKeywordsByUrl?.[candidate?.targetPageUrl] ??
    targetPageKeywordsByUrl?.[candidate?.url] ??
    null
  );
}

function collectTargetKeywordWeights(targetKeywordWeights, pageKeywordEntry) {
  for (const keyword of pageKeywordEntry?.keywords ?? []) {
    const keywordText = normalizeKeywordMatchText(keyword?.text);

    if (!keywordText) {
      continue;
    }

    const weightedScore =
      KEYWORD_FIELD_WEIGHTS.targetKeyword * clampAiKeywordScore(keyword?.score);
    const previousWeightedScore = targetKeywordWeights.get(keywordText) ?? 0;

    if (weightedScore > previousWeightedScore) {
      targetKeywordWeights.set(keywordText, weightedScore);
    }
  }
}

function buildSiteSemanticFieldEntriesFromAggregate(aggregate) {
  const fieldEntries = [];
  const aggregateLinkFields = aggregate.linkFields;

  pushSemanticField(
    fieldEntries,
    "anchorText",
    [...aggregateLinkFields.anchorText].join(" "),
    KEYWORD_FIELD_WEIGHTS.anchorText
  );
  pushSemanticField(
    fieldEntries,
    "nearbyText",
    [...aggregateLinkFields.nearbyText].join(" "),
    KEYWORD_FIELD_WEIGHTS.nearbyText
  );
  pushSemanticField(
    fieldEntries,
    "titleAttr",
    [...aggregateLinkFields.titleAttr].join(" "),
    KEYWORD_FIELD_WEIGHTS.titleAttr
  );
  pushSemanticField(
    fieldEntries,
    "ariaLabel",
    [...aggregateLinkFields.ariaLabel].join(" "),
    KEYWORD_FIELD_WEIGHTS.ariaLabel
  );
  pushSemanticField(
    fieldEntries,
    "imageAlt",
    [...aggregateLinkFields.imageAlt].join(" "),
    KEYWORD_FIELD_WEIGHTS.imageAlt
  );
  pushSemanticField(
    fieldEntries,
    "hrefPathTokens",
    [...aggregateLinkFields.hrefPathTokens].join(" "),
    KEYWORD_FIELD_WEIGHTS.hrefPathTokens
  );

  for (const [keywordText, weightedScore] of aggregate.targetKeywordWeights.entries()) {
    fieldEntries.push({
      field: "targetKeyword",
      text: keywordText,
      weight: weightedScore,
    });
  }

  for (const targetTitle of aggregate.targetTitles) {
    fieldEntries.push({
      field: "targetTitle",
      text: targetTitle,
      weight: KEYWORD_FIELD_WEIGHTS.targetTitle,
    });
  }

  for (const targetPageType of aggregate.targetPageTypes) {
    fieldEntries.push({
      field: "targetPageType",
      text: targetPageType,
      weight: KEYWORD_FIELD_WEIGHTS.targetPageType,
    });
  }

  return fieldEntries;
}

function collectSiteFieldTexts(textSet, rawText) {
  const normalizedText = normalizeKeywordMatchText(rawText);

  if (normalizedText) {
    textSet.add(normalizedText);
  }
}

function pushSemanticField(fieldEntries, field, rawText, weight) {
  const text = normalizeKeywordMatchText(rawText);

  if (!text) {
    return;
  }

  fieldEntries.push({
    field,
    text,
    weight,
  });
}

function computeKeywordFieldContribution(interestKeyword, interestKeywordText, fieldEntry) {
  if (!fieldEntry?.text || !fieldEntry?.weight) {
    return null;
  }

  const matchWeight = resolveKeywordMatchWeight(interestKeywordText, fieldEntry.text);

  if (matchWeight <= 0) {
    return null;
  }

  return {
    interestKeyword: interestKeyword.text,
    field: fieldEntry.field,
    matchedText: fieldEntry.text,
    contribution:
      clampAiKeywordScore(interestKeyword.score) * fieldEntry.weight * matchWeight,
  };
}

function resolveKeywordMatchWeight(keywordText, fieldText) {
  if (!keywordText || !fieldText) {
    return 0;
  }

  if (fieldText === keywordText) {
    return 1;
  }

  if (fieldText.includes(keywordText) || keywordText.includes(fieldText)) {
    return 0.8;
  }

  const keywordTokens = tokenizeKeywordMatchText(keywordText);
  const fieldTokens = tokenizeKeywordMatchText(fieldText);
  const sharedTokens = keywordTokens.filter((token) => fieldTokens.includes(token));

  if (sharedTokens.length > 0) {
    return 0.6;
  }

  return 0;
}

function resolveKeywordMatchTier(matchStrength) {
  if (matchStrength >= 2.5) {
    return "strong";
  }

  if (matchStrength >= 1.6) {
    return "medium";
  }

  if (matchStrength >= 0.9) {
    return "weak";
  }

  return "none";
}

function normalizeKeywordMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_\-\/\\]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeKeywordMatchText(value) {
  return normalizeKeywordMatchText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

globalThis.ZeroLatencyAiKeywords = {
  MAX_AI_KEYWORD_COUNT,
  KEYWORD_MATCH_MULTIPLIERS,
  buildPageKeywordPrompt,
  buildContextKeywordPrompt,
  buildHistoryPagePoolRecords,
  buildAiKeywordMatchResult,
  buildSiteAiKeywordMatchResult,
  parseAiKeywordInferenceResponse,
};
