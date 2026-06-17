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
