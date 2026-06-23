(function () {
  const DEFAULT_ATTENTION_POOL_DURATION_MS = 30 * 60 * 1000;
  const DEFAULT_ATTENTION_SEGMENT_DURATION_MS = 60 * 1000;
  const DEFAULT_ATTENTION_MIN_SLICE_MS = 250;
  const DEFAULT_ATTENTION_MAX_OBSERVABLE_GAP_MS = 60 * 1000;
  const DEFAULT_ATTENTION_INPUT_WINDOW_MS = 30 * 1000;
  const DEFAULT_ATTENTION_MEDIA_PLAYBACK_WEIGHT = 0;
  const DEFAULT_ATTENTION_AUDIO_PLAYBACK_WEIGHT = 0;
  const DEFAULT_ATTENTION_LINK_SOFT_DECAY_MS = 60 * 1000;
  const DEFAULT_ATTENTION_LINK_SOFT_DECAY_WEIGHT = 0.25;
  const DEFAULT_ATTENTION_LINK_HARD_DECAY_MS = 180 * 1000;
  const DEFAULT_ATTENTION_LINK_HARD_DECAY_WEIGHT = 0.1;
  const DEFAULT_ATTENTION_LINK_ZERO_MS = 300 * 1000;
  const DEFAULT_ATTENTION_SITE_SHARE_RATIO = 0.5;

  function resolvePreloadAttentionOptions(options = {}) {
    return {
      enabled: options.enabled !== false,
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
      linkSoftDecayMs: normalizeDurationMs(
        options.linkSoftDecayMs,
        DEFAULT_ATTENTION_LINK_SOFT_DECAY_MS
      ),
      linkSoftDecayWeight: normalizeWeight(
        options.linkSoftDecayWeight,
        DEFAULT_ATTENTION_LINK_SOFT_DECAY_WEIGHT
      ),
      linkHardDecayMs: normalizeDurationMs(
        options.linkHardDecayMs,
        DEFAULT_ATTENTION_LINK_HARD_DECAY_MS
      ),
      linkHardDecayWeight: normalizeWeight(
        options.linkHardDecayWeight,
        DEFAULT_ATTENTION_LINK_HARD_DECAY_WEIGHT
      ),
      linkZeroMs: normalizeDurationMs(
        options.linkZeroMs,
        DEFAULT_ATTENTION_LINK_ZERO_MS
      ),
      siteShareRatio: normalizeWeight(
        options.siteShareRatio,
        DEFAULT_ATTENTION_SITE_SHARE_RATIO
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
    DEFAULT_ATTENTION_LINK_SOFT_DECAY_MS,
    DEFAULT_ATTENTION_LINK_SOFT_DECAY_WEIGHT,
    DEFAULT_ATTENTION_LINK_HARD_DECAY_MS,
    DEFAULT_ATTENTION_LINK_HARD_DECAY_WEIGHT,
    DEFAULT_ATTENTION_LINK_ZERO_MS,
    DEFAULT_ATTENTION_SITE_SHARE_RATIO,
    resolvePreloadAttentionOptions,
    normalizeDurationMs,
    normalizeWeight,
    parseTimestampMs,
    advanceIsoTimestamp,
    recordSchedulerEvent,
  };
})();
