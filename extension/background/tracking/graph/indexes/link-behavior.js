function getRecordedLinkBehavior(graph, sourcePageUrl, targetUrl) {
  const normalizedSourcePageUrl = normalizePageUrlForIndex(sourcePageUrl || "");
  const normalizedTargetUrl = normalizePageUrlForIndex(targetUrl || "");

  if (!normalizedSourcePageUrl || !normalizedTargetUrl) {
    return null;
  }

  return graph.linkBehaviorStore?.[normalizedSourcePageUrl]?.[normalizedTargetUrl] ?? null;
}

function getRecordedLinkTargetHint(graph, sourcePageUrl, targetUrl) {
  const behavior = getRecordedLinkBehavior(graph, sourcePageUrl, targetUrl);

  if (!behavior) {
    return null;
  }

  if (behavior.blankCount > behavior.selfCount) {
    return "_blank";
  }

  if (behavior.selfCount > behavior.blankCount) {
    return "_self";
  }

  return behavior.lastTargetHint === "_blank" ? "_blank" : "_self";
}
