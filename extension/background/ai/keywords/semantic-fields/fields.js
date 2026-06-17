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

function collectSiteFieldTexts(textSet, rawText) {
  const normalizedText = normalizeKeywordMatchText(rawText);

  if (normalizedText) {
    textSet.add(normalizedText);
  }
}
