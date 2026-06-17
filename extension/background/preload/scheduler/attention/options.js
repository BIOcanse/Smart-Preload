(function () {
  const DEFAULT_ATTENTION_POOL_DURATION_MS = 5 * 60 * 60 * 1000;
  const DEFAULT_ATTENTION_SEGMENT_DURATION_MS = 60 * 1000;
  const DEFAULT_ATTENTION_MIN_SLICE_MS = 250;
  const DEFAULT_ATTENTION_MAX_OBSERVABLE_GAP_MS = 60 * 1000;
  const DEFAULT_ATTENTION_INPUT_WINDOW_MS = 60 * 1000;
  const DEFAULT_ATTENTION_MEDIA_PLAYBACK_WEIGHT = 0.2;
  const DEFAULT_ATTENTION_AUDIO_PLAYBACK_WEIGHT = 0.07;

  function resolvePreloadAttentionOptions(options = {}) {
    return {
      poolDurationMs: normalizeDurationMs(
        options.poolDurationMs,
        DEFAULT_ATTENTION_POOL_DURATION_MS
      ),
      segmentDurationMs: normalizeDurationMs(
        options.segmentDurationMs,
        DEFAULT_ATTENTION_SEGMENT_DURATION_MS
      ),
      minSliceMs: normalizeDurationMs(
        options.minSliceMs,
        DEFAULT_ATTENTION_MIN_SLICE_MS
      ),
      maxObservableGapMs: normalizeDurationMs(
        options.maxObservableGapMs,
        DEFAULT_ATTENTION_MAX_OBSERVABLE_GAP_MS
      ),
      inputWindowMs: normalizeDurationMs(
        options.inputWindowMs,
        DEFAULT_ATTENTION_INPUT_WINDOW_MS
      ),
      mediaPlaybackWeight: normalizeWeight(
        options.mediaPlaybackWeight,
        DEFAULT_ATTENTION_MEDIA_PLAYBACK_WEIGHT
      ),
      audioPlaybackWeight: normalizeWeight(
        options.audioPlaybackWeight,
        DEFAULT_ATTENTION_AUDIO_PLAYBACK_WEIGHT
      ),
    };
  }

  function normalizeDurationMs(value, fallback) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return fallback;
    }

    return numericValue;
  }

  function normalizeWeight(value, fallback) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return fallback;
    }

    return Math.min(1, Math.max(0, numericValue));
  }

  function parseTimestampMs(value) {
    if (typeof value !== "string") {
      return null;
    }

    const parsedValue = Date.parse(value);
    return Number.isNaN(parsedValue) ? null : parsedValue;
  }

  function advanceIsoTimestamp(timestamp, durationMs) {
    const timestampMs = parseTimestampMs(timestamp);

    if (timestampMs === null) {
      return timestamp;
    }

    return new Date(timestampMs + durationMs).toISOString();
  }

  function recordSchedulerEvent(eventName, payload = {}) {
    globalThis.ZeroLatencyDebugEvents?.record?.(eventName, payload);
  }

  globalThis.ZeroLatencyPreloadAttentionOptions = {
    DEFAULT_ATTENTION_POOL_DURATION_MS,
    DEFAULT_ATTENTION_SEGMENT_DURATION_MS,
    DEFAULT_ATTENTION_MIN_SLICE_MS,
    DEFAULT_ATTENTION_MAX_OBSERVABLE_GAP_MS,
    DEFAULT_ATTENTION_INPUT_WINDOW_MS,
    DEFAULT_ATTENTION_MEDIA_PLAYBACK_WEIGHT,
    DEFAULT_ATTENTION_AUDIO_PLAYBACK_WEIGHT,
    resolvePreloadAttentionOptions,
    normalizeDurationMs,
    normalizeWeight,
    parseTimestampMs,
    advanceIsoTimestamp,
    recordSchedulerEvent,
  };
})();
