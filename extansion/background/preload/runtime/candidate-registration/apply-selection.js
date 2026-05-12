async function applyPreloadCandidateSelection({ sourceTab, sourceTabId, selection }) {
  await queueMutation(async () => {
    if (await isExtensionServicePaused()) {
      return;
    }

    let latestPreloadState = await loadPreloadState();
    latestPreloadState = await synchronizePreloadsForSourceTab(
      latestPreloadState,
      sourceTab.windowId,
      sourceTabId,
      selection.tabTargets
    );
    latestPreloadState = synchronizePrerenderEntriesForSourceTab(
      latestPreloadState,
      sourceTab.windowId,
      sourceTabId,
      selection.selectedTargets.filter((target) => target.strategy === "prerender")
    );
    latestPreloadState = synchronizePrefetchEntriesForSourceTab(
      latestPreloadState,
      sourceTab.windowId,
      sourceTabId,
      selection.selectedTargets.filter((target) => target.strategy === "prefetch")
    );
    await savePreloadState(latestPreloadState);
  });
}
