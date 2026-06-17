(function () {
  const { recordSchedulerEvent } = globalThis.ZeroLatencyPreloadAttentionOptions;

  async function reschedulePreloadAttentionObservationResult(result) {
    result.scheduledSelections = [];

    if (result.recordedDurationMs <= 0) {
      return result;
    }

    const schedulerSelections = globalThis.ZeroLatencyPreloadSchedulerSelections;

    if (typeof schedulerSelections?.rescheduleStoredPreloadSelections !== "function") {
      recordSchedulerEvent("scheduler.attention.reschedule", {
        recordedDurationMs: result.recordedDurationMs,
        skipped: true,
        reason: "rescheduler-unavailable",
      });
      return result;
    }

    const rescheduleResult = await schedulerSelections.rescheduleStoredPreloadSelections(
      result.preloadState,
      {
        settings: globalThis.getEffectiveExtensionSettings?.() ?? null,
      }
    );

    if (rescheduleResult?.preloadState) {
      result.preloadState = rescheduleResult.preloadState;
    }

    result.scheduledSelections = Array.isArray(rescheduleResult?.scheduledSelections)
      ? rescheduleResult.scheduledSelections
      : [];
    recordSchedulerEvent("scheduler.attention.reschedule", {
      recordedDurationMs: result.recordedDurationMs,
      skipped: false,
      scheduledSourceTabCount: result.scheduledSelections.length,
      scheduledSourceTabIds: result.scheduledSelections.map((entry) => entry.sourceTabId),
      mode: "stored-snapshot",
      recomputedCandidateScores: false,
    });
    return result;
  }

  async function notifyAttentionReschedule(result) {
    if (!Array.isArray(result?.scheduledSelections) || result.scheduledSelections.length === 0) {
      return;
    }

    await globalThis.ZeroLatencyPreloadSchedulerSelections?.notifyScheduledSourceTabs?.(
      result.scheduledSelections
    );
  }

  globalThis.ZeroLatencyPreloadAttentionReschedule = {
    reschedulePreloadAttentionObservationResult,
    notifyAttentionReschedule,
  };
})();
