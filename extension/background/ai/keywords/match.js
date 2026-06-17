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
