async function handleDeleteHistoryRange(message) {
  const rawRange = message?.range ?? message;
  const normalizedRange =
    globalThis.ZeroLatencyTrackingHistoryDeletion.normalizeHistoryDeletionRange(rawRange);
  const task = globalThis.ZeroLatencyBackgroundTasks.submitTask({
    kind: "tracking.history-delete-range",
    queueId: "tracking-history",
    title: "Delete tracking history range",
    description: "Delete local visit graph history records in a UTC date range.",
    dedupeKey: `tracking.history-delete-range:${normalizedRange.startDate}:${normalizedRange.endDate}`,
    run: async (context) => {
      context.setProgress({
        step: "waiting-for-state-lock",
        message: "Waiting for tracking state lock.",
        progress: {
          percent: 10,
        },
      });

      return queueMutation(async () => {
        context.setProgress({
          step: "deleting-history",
          message: "Deleting selected history records.",
          progress: {
            percent: 45,
          },
        });

        const trackingState = await loadTrackingState();
        const deletion = globalThis.ZeroLatencyTrackingHistoryDeletion.deleteTrackingHistoryRange(
          trackingState,
          normalizedRange
        );

        await saveTrackingState(deletion.state);
        globalThis.ZeroLatencyDebugEvents?.record?.("tracking.history.delete-range", {
          range: deletion.result.range,
          deleted: deletion.result.deleted,
          after: deletion.result.after,
        });

        context.setProgress({
          step: "completed",
          message: "History deletion completed.",
          progress: {
            percent: 100,
          },
        });

        return deletion.result;
      });
    },
  });

  return {
    ok: true,
    taskId: task.taskId,
    task,
    range: {
      startDate: normalizedRange.startDate,
      endDate: normalizedRange.endDate,
      startAt: normalizedRange.startAt,
      endAt: normalizedRange.endAt,
      exclusiveEnd: true,
    },
  };
}
