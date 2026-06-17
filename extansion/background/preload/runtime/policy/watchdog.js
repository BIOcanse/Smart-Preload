async function enforcePreloadWindowPolicy() {
  const context = await resolvePreloadWatchdogRunContext();

  if (context.shouldRun !== true) {
    return;
  }

  const nativeOnlyCleanup = await applyPreloadWatchdogNativeOnlyModeCleanup(context);

  if (nativeOnlyCleanup.handled) {
    return;
  }

  const heartbeatVerdicts = await collectPreloadWatchdogHeartbeatVerdicts(
    context.runtimeSettings
  );
  const pressureResult = await applyPreloadWatchdogResourcePressure(
    context,
    heartbeatVerdicts
  );

  refreshPreloadPerformanceWarningAfterHeartbeat(heartbeatVerdicts);

  if (pressureResult.handled) {
    return;
  }

  await runPreloadWatchdogWindowMaintenance(context);
}
