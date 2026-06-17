async function runPreloadWatchdogWindowMaintenance(context) {
  if (context.runtimeSettings.preloadWindow.watchdogEnabled !== true) {
    return {
      didRun: false,
      didMutate: false,
    };
  }

  const didMutate = await maintainPreloadWindowsForWatchdog(
    context.preloadState,
    context.preloadWindowManager
  );

  if (didMutate) {
    await savePreloadState(context.preloadState);
  }

  return {
    didRun: true,
    didMutate: didMutate === true,
  };
}
