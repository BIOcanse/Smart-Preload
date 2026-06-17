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
