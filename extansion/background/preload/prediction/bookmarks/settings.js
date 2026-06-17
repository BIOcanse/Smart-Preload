function isGoogleBookmarkPreloadEnabled(settings, sourceUrl) {
  return (
    settingsApi.isRuleCardEnabled(getGoogleBookmarkPreloadRuleCardState(settings)) &&
    isGoogleSearchPageForBookmarkPreload(sourceUrl)
  );
}

function getGoogleBookmarkPreloadRuleCardState(settings) {
  return settings?.layout?.ruleCards?.items?.googleBookmarkRank ?? null;
}
