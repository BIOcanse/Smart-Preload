async function applyPreloadCandidateSelection({ sourceTab, sourceTabId, selection }) {
  await queueMutation(async () => {
    if (await isExtensionServicePaused()) {
      return;
    }

    let latestPreloadState = await globalThis.ZeroLatencyPreloadRegistry.load();
    latestPreloadState = await globalThis.ZeroLatencyPreloadDiff.applySourceTabSelection({
      preloadState: latestPreloadState,
      sourceWindowId: sourceTab.windowId,
      sourceTabId,
      selection,
    });
    await globalThis.ZeroLatencyPreloadRegistry.save(latestPreloadState);
  });
}
