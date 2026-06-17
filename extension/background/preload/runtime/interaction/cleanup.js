async function clearInteractionPreloadsForSource(preloadState, context, options = {}) {
  const sourceTab = context.sourceTab;
  const sourceRuntimeEntry = getSourceTabRuntimeForWindow(
    preloadState,
    sourceTab.windowId,
    String(sourceTab.id)
  );

  if (!sourceRuntimeEntry) {
    return preloadState;
  }

  const trigger =
    options.trigger === "contextmenu" ? "contextmenu" : options.trigger === "hover" ? "hover" : null;
  const keepUrl = typeof options.keepUrl === "string" ? options.keepUrl : "";
  let mutated = false;

  for (const [url, entry] of Object.entries(
    getSourceTabPreloadChannelStore(sourceRuntimeEntry.sourceTabRuntime, "hiddenTab")
  )) {
    if (!shouldClearInteractionEntry(entry, { trigger, keepUrl, url })) {
      continue;
    }

    await closeTabIfExists(entry.tabId);
    deleteSourceTabPreloadEntry(sourceRuntimeEntry.sourceTabRuntime, "hiddenTab", url);
    mutated = true;
  }

  mutated =
    clearSyntheticInteractionEntries(
      sourceRuntimeEntry.sourceTabRuntime,
      "prerender",
      { trigger, keepUrl }
    ) || mutated;
  mutated =
    clearSyntheticInteractionEntries(
      sourceRuntimeEntry.sourceTabRuntime,
      "prefetch",
      { trigger, keepUrl }
    ) || mutated;

  if (mutated) {
    markSourceRuntimeUpdated(preloadState, sourceRuntimeEntry, new Date().toISOString());
    pruneSourceTabRuntime(preloadState, sourceTab.windowId, String(sourceTab.id));
  }

  return preloadState;
}

function clearSyntheticInteractionEntries(sourceTabRuntime, channel, options) {
  let mutated = false;

  for (const [url, entry] of Object.entries(
    getSourceTabPreloadChannelStore(sourceTabRuntime, channel)
  )) {
    if (!shouldClearInteractionEntry(entry, { ...options, url })) {
      continue;
    }

    deleteSourceTabPreloadEntry(sourceTabRuntime, channel, url);
    mutated = true;
  }

  return mutated;
}

function shouldClearInteractionEntry(entry, { trigger, keepUrl, url }) {
  if (!entry?.interactionPreload) {
    return false;
  }

  if (keepUrl && keepUrl === url) {
    return false;
  }

  return !trigger || entry.interactionPreload.trigger === trigger;
}

function markSourceRuntimeUpdated(preloadState, sourceRuntimeEntry, updatedAt) {
  markSourceTabPreloadChannelsUpdated(preloadState, sourceRuntimeEntry, updatedAt);
}
