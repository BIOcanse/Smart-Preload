function shouldKeepIndependentBookmarkPreloadTarget(target, snapshot, settings) {
  if (!isIndependentBookmarkPreloadTarget(target)) {
    return false;
  }

  if (!settings) {
    return true;
  }

  const bookmarkRuleCardState =
    settings?.layout?.ruleCards?.items?.googleBookmarkRank ?? null;

  if (!settingsApi.isRuleCardEnabled(bookmarkRuleCardState)) {
    return false;
  }

  if (
    typeof isGoogleSearchPageForBookmarkPreload === "function" &&
    !isGoogleSearchPageForBookmarkPreload(snapshot?.sourcePageUrl || "")
  ) {
    return false;
  }

  return settingsApi.evaluateRuleCardMetric(
    bookmarkRuleCardState,
    clampNonNegativeInt(target?.bookmarkPreload?.rank, 0)
  );
}
