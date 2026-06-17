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
