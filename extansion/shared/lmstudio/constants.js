(() => {
  const PROVIDER_ID = "lmstudio";
  const API_BASE_URL = "http://127.0.0.1:1234";

  globalThis.ZeroLatencyLmStudioConstants = Object.freeze({
    PROVIDER_ID,
    API_BASE_URL,
    CHAT_COMPLETIONS_URL: `${API_BASE_URL}/v1/chat/completions`,
    MODELS_URL: `${API_BASE_URL}/api/v1/models`,
    LOAD_MODEL_URL: `${API_BASE_URL}/api/v1/models/load`,
    UNLOAD_MODEL_URL: `${API_BASE_URL}/api/v1/models/unload`,
    DEFAULT_REQUEST_TIMEOUT_MS: 5_000,
    DEFAULT_LOAD_TIMEOUT_MS: 120_000,
    DEFAULT_LOAD_POLL_INTERVAL_MS: 1_500,
  });
})();
