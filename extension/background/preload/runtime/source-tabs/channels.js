const SOURCE_TAB_PRELOAD_CHANNEL_STORE_KEYS = Object.freeze({
  hiddenTab: "hiddenTabEntriesByUrl",
  prerender: "prerenderEntriesByUrl",
  prefetch: "prefetchEntriesByUrl",
});

function getSourceTabPreloadChannelStore(sourceTabRuntime, channel) {
  const storeKey = SOURCE_TAB_PRELOAD_CHANNEL_STORE_KEYS[channel];

  if (!storeKey || !sourceTabRuntime || typeof sourceTabRuntime !== "object") {
    return {};
  }

  return sourceTabRuntime[storeKey] || {};
}

function setSourceTabPreloadChannelStore(sourceTabRuntime, channel, entriesByUrl) {
  const storeKey = SOURCE_TAB_PRELOAD_CHANNEL_STORE_KEYS[channel];

  if (!storeKey || !sourceTabRuntime || typeof sourceTabRuntime !== "object") {
    return;
  }

  sourceTabRuntime[storeKey] =
    entriesByUrl && typeof entriesByUrl === "object" ? entriesByUrl : {};
}

function getSourceTabPreloadEntry(sourceTabRuntime, channel, url) {
  if (typeof url !== "string" || !url) {
    return null;
  }

  return getSourceTabPreloadChannelStore(sourceTabRuntime, channel)?.[url] ?? null;
}

function setSourceTabPreloadEntry(sourceTabRuntime, channel, url, entry) {
  if (typeof url !== "string" || !url) {
    return false;
  }

  const storeKey = SOURCE_TAB_PRELOAD_CHANNEL_STORE_KEYS[channel];

  if (!storeKey || !sourceTabRuntime || typeof sourceTabRuntime !== "object") {
    return false;
  }

  if (!sourceTabRuntime[storeKey] || typeof sourceTabRuntime[storeKey] !== "object") {
    sourceTabRuntime[storeKey] = {};
  }

  sourceTabRuntime[storeKey][url] = entry;
  return true;
}

function deleteSourceTabPreloadEntry(sourceTabRuntime, channel, url) {
  const entry = getSourceTabPreloadEntry(sourceTabRuntime, channel, url);

  if (!entry) {
    return null;
  }

  delete sourceTabRuntime[SOURCE_TAB_PRELOAD_CHANNEL_STORE_KEYS[channel]][url];
  return entry;
}

function hasSourceTabPreloadEntryInAnyChannel(sourceTabRuntime, url, channels = null) {
  const selectedChannels = Array.isArray(channels)
    ? channels
    : Object.keys(SOURCE_TAB_PRELOAD_CHANNEL_STORE_KEYS);

  return selectedChannels.some((channel) =>
    Boolean(getSourceTabPreloadEntry(sourceTabRuntime, channel, url))
  );
}

function clearSourceTabPreloadChannelStores(sourceTabRuntime, channels = null) {
  const selectedChannels = Array.isArray(channels)
    ? channels
    : Object.keys(SOURCE_TAB_PRELOAD_CHANNEL_STORE_KEYS);

  for (const channel of selectedChannels) {
    setSourceTabPreloadChannelStore(sourceTabRuntime, channel, {});
  }
}

function copyInteractionPreloadEntries(entriesByUrl) {
  const nextEntries = {};

  for (const [url, entry] of Object.entries(entriesByUrl || {})) {
    if (entry?.interactionPreload) {
      nextEntries[url] = entry;
    }
  }

  return nextEntries;
}

function getSourceTabSpeculationChannelForStrategy(strategy) {
  if (strategy === "prerender") {
    return "prerender";
  }

  if (strategy === "prefetch") {
    return "prefetch";
  }

  return null;
}

function markSourceTabPreloadChannelsUpdated(
  preloadState,
  sourceRuntimeEntry,
  updatedAt = new Date().toISOString()
) {
  sourceRuntimeEntry.sourceTabRuntime.updatedAt = updatedAt;
  sourceRuntimeEntry.normalWindowRuntime.updatedAt = updatedAt;
  preloadState.updatedAt = updatedAt;
  return updatedAt;
}
