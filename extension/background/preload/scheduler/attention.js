(function () {
  const optionsApi = globalThis.ZeroLatencyPreloadAttentionOptions;
  const poolApi = globalThis.ZeroLatencyPreloadAttentionPool;
  const activityApi = globalThis.ZeroLatencyPreloadAttentionActivity;
  const observationApi = globalThis.ZeroLatencyPreloadAttentionObservation;
  const runtimeApi = globalThis.ZeroLatencyPreloadAttentionRuntime;

  globalThis.ZeroLatencyPreloadSchedulerAttention = {
    DEFAULT_ATTENTION_POOL_DURATION_MS: optionsApi.DEFAULT_ATTENTION_POOL_DURATION_MS,
    DEFAULT_ATTENTION_SEGMENT_DURATION_MS: optionsApi.DEFAULT_ATTENTION_SEGMENT_DURATION_MS,
    DEFAULT_ATTENTION_MIN_SLICE_MS: optionsApi.DEFAULT_ATTENTION_MIN_SLICE_MS,
    DEFAULT_ATTENTION_MAX_OBSERVABLE_GAP_MS:
      optionsApi.DEFAULT_ATTENTION_MAX_OBSERVABLE_GAP_MS,
    DEFAULT_ATTENTION_INPUT_WINDOW_MS: optionsApi.DEFAULT_ATTENTION_INPUT_WINDOW_MS,
    DEFAULT_ATTENTION_MEDIA_PLAYBACK_WEIGHT:
      optionsApi.DEFAULT_ATTENTION_MEDIA_PLAYBACK_WEIGHT,
    DEFAULT_ATTENTION_AUDIO_PLAYBACK_WEIGHT:
      optionsApi.DEFAULT_ATTENTION_AUDIO_PLAYBACK_WEIGHT,
    resolvePreloadAttentionOptions: optionsApi.resolvePreloadAttentionOptions,
    appendPreloadAttentionDuration: poolApi.appendPreloadAttentionDuration,
    trimPreloadAttentionPool: poolApi.trimPreloadAttentionPool,
    recordPreloadAttentionObservation: observationApi.recordPreloadAttentionObservation,
    computePreloadAttentionDwellShares: poolApi.computePreloadAttentionDwellShares,
    buildPreloadAttentionTabKey: poolApi.buildPreloadAttentionTabKey,
    buildPreloadAttentionRuntimeOptions: activityApi.buildPreloadAttentionRuntimeOptions,
    resolveAttentionActivity: activityApi.resolveAttentionActivity,
    recordActiveTabAttentionFromActiveInfo: runtimeApi.recordActiveTabAttentionFromActiveInfo,
    recordActiveTabAttentionFromSender: runtimeApi.recordActiveTabAttentionFromSender,
    recordActiveTabAttentionFromNavigationDetails:
      runtimeApi.recordActiveTabAttentionFromNavigationDetails,
    recordActiveTabAttentionFromFocusedWindow:
      runtimeApi.recordActiveTabAttentionFromFocusedWindow,
    pausePreloadAttentionCursor: runtimeApi.pausePreloadAttentionCursor,
    pausePreloadAttentionCursorIfMatches: runtimeApi.pausePreloadAttentionCursorIfMatches,
    flushPendingAttention: runtimeApi.flushPendingAttention,
    discardPendingAttention: runtimeApi.discardPendingAttention,
  };
})();
