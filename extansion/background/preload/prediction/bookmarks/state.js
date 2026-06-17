async function resolveGoogleBookmarkPreloadTargetContext({
  settings,
  sourceUrl,
  sourceTabId,
  sourceWindowId,
}) {
  if (!isGoogleBookmarkPreloadEnabled(settings, sourceUrl)) {
    return null;
  }

  if (globalThis.ZeroLatencySupport?.hasChromeNamespaceMethod?.("bookmarks", "getTree") !== true) {
    recordGoogleBookmarkPreloadDiagnostic("prediction.google-bookmarks.skip", {
      reason: "bookmarks-api-unavailable",
      sourceUrl,
    });
    return null;
  }

  const bucketKey = await resolveGoogleBookmarkPreloadBucketKey({
    sourceUrl,
    sourceTabId,
    sourceWindowId,
  });

  if (!bucketKey) {
    return null;
  }

  const bookmarkEntries = await collectChromeBookmarkEntries(sourceUrl);

  if (bookmarkEntries.length === 0) {
    return null;
  }

  return {
    bucketKey,
    bookmarkEntries,
  };
}

async function resolveGoogleBookmarkPreloadBucketKey({
  sourceUrl,
  sourceTabId,
  sourceWindowId,
}) {
  if (!isGoogleSearchPageForBookmarkPreload(sourceUrl)) {
    return null;
  }

  const serviceState = await ensureGoogleBookmarkStartupAnchor({
    serviceState: await loadServiceState(),
    sourceUrl,
    sourceTabId,
    sourceWindowId,
  });
  return resolveGoogleBookmarkPreloadBucketKeyFromServiceState({
    serviceState,
    sourceTabId,
    sourceWindowId,
  });
}

function resolveGoogleBookmarkPreloadBucketKeyFromServiceState({
  serviceState,
  sourceTabId,
  sourceWindowId,
}) {
  const bookmarkState = normalizeBookmarkPreloadingServiceState(
    serviceState?.bookmarkPreloading
  );
  const normalizedSourceTabId = normalizePositiveInteger(sourceTabId, null);
  const normalizedSourceWindowId = normalizePositiveInteger(sourceWindowId, null);

  if (
    normalizedSourceTabId !== null &&
    normalizedSourceTabId === bookmarkState.startupGoogleSearchTabId &&
    (normalizedSourceWindowId === null ||
      normalizedSourceWindowId === bookmarkState.startupGoogleSearchWindowId)
  ) {
    return BOOKMARK_PRELOAD_BUCKET_STARTUP_GOOGLE_SEARCH;
  }

  return BOOKMARK_PRELOAD_BUCKET_NEW_GOOGLE_SEARCH_TAB;
}

async function ensureGoogleBookmarkStartupAnchor({
  serviceState,
  sourceUrl,
  sourceTabId,
  sourceWindowId,
}) {
  const normalizedServiceState = normalizeServiceState(serviceState);
  const bookmarkState = normalizeBookmarkPreloadingServiceState(
    normalizedServiceState.bookmarkPreloading
  );

  if (
    bookmarkState.startupGoogleSearchTabId !== null &&
    bookmarkState.startupGoogleSearchWindowId !== null
  ) {
    return normalizedServiceState;
  }

  if (!isGoogleSearchPageForBookmarkPreload(sourceUrl)) {
    return normalizedServiceState;
  }

  const normalizedSourceTabId = normalizePositiveInteger(sourceTabId, null);
  let normalizedSourceWindowId = normalizePositiveInteger(sourceWindowId, null);

  if (normalizedSourceTabId === null) {
    return normalizedServiceState;
  }

  if (normalizedSourceWindowId === null) {
    const sourceTab = await getTabMaybe(normalizedSourceTabId);
    normalizedSourceWindowId = normalizePositiveInteger(sourceTab?.windowId, null);
  }

  if (normalizedSourceWindowId === null) {
    return normalizedServiceState;
  }

  normalizedServiceState.bookmarkPreloading = {
    startupGoogleSearchTabId: normalizedSourceTabId,
    startupGoogleSearchWindowId: normalizedSourceWindowId,
  };
  normalizedServiceState.updatedAt = new Date().toISOString();
  await saveServiceState(normalizedServiceState);
  recordGoogleBookmarkPreloadDiagnostic("prediction.google-bookmarks.startup-anchor.saved", {
    sourceTabId: normalizedSourceTabId,
    sourceWindowId: normalizedSourceWindowId,
    sourceUrl,
  });
  return normalizedServiceState;
}
