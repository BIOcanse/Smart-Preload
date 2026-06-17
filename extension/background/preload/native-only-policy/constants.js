const NATIVE_APP_MISSING_WARNING_DELAY_MS = 60 * 1000;
const NATIVE_APP_MISSING_WARNING_STORAGE_KEY = "nativeAppMissingWarningObservedAtMsV1";
const REAL_PRELOAD_RECOMMENDATION_MEMORY_THRESHOLD_BYTES = 24 * 1024 * 1024 * 1024;
const NATIVE_APP_MISSING_WARNING_FALLBACK =
  "Real Preload needs the Windows app. It has not been detected for 1 minute; install the app or turn off Real Preload.";
const REAL_PRELOAD_LOW_MEMORY_RECOMMENDATION_FALLBACK =
  "Real Preload is available and can reduce perceived latency to zero, but this computer has less than 24 GB of memory; it is not recommended for most users.";
const REAL_PRELOAD_RECOMMENDED_FALLBACK =
  "Real Preload is available and recommended on this machine. It can reduce perceived latency to zero, but uses a lot of memory; avoid overly aggressive limits.";
