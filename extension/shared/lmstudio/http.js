(() => {
  const constants = globalThis.ZeroLatencyLmStudioConstants;

  async function fetchJson(url, options = {}) {
    const timeoutMs = Number(options.timeoutMs) || constants.DEFAULT_REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const abortExternalSignal = () => controller.abort();

    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener("abort", abortExternalSignal, { once: true });
      }
    }

    try {
      const response = await fetch(url, {
        method: options.method || "GET",
        headers: options.body ? { "content-type": "application/json" } : {},
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      const responseText = await response.text();

      if (!response.ok) {
        throw new Error(
          `LM Studio responded with HTTP ${response.status}: ${responseText.slice(0, 200)}`
        );
      }

      return responseText ? JSON.parse(responseText) : {};
    } finally {
      clearTimeout(timeoutId);
      options.signal?.removeEventListener?.("abort", abortExternalSignal);
    }
  }

  function sleep(delayMs) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  globalThis.ZeroLatencyLmStudioHttp = {
    fetchJson,
    sleep,
  };
})();
