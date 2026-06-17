(() => {
  function buildModelsRequest(providerId, endpointUrl, apiKey) {
    if (isLmStudioProvider(providerId)) {
      return null;
    }

    if (providerId === "gemini") {
      const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
      url.searchParams.set("key", apiKey);
      return {
        url: url.href,
        headers: {},
      };
    }

    if (providerId === "anthropic" || providerId === "claude") {
      return {
        url: "https://api.anthropic.com/v1/models",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
      };
    }

    const modelsUrl =
      providerId === "openrouter"
        ? "https://openrouter.ai/api/v1/models"
        : deriveOpenAiCompatibleModelsUrl(endpointUrl);

    if (!modelsUrl) {
      return null;
    }

    const headers = {};

    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }

    return {
      url: modelsUrl,
      headers,
    };
  }

  function deriveOpenAiCompatibleModelsUrl(endpointUrl) {
    if (typeof endpointUrl !== "string" || !endpointUrl.trim()) {
      return null;
    }

    try {
      const url = new URL(endpointUrl);
      url.pathname = url.pathname
        .replace(/\/chat\/completions\/?$/u, "/models")
        .replace(/\/messages\/?$/u, "/models")
        .replace(/\/generateContent\/?$/u, "/models");
      url.search = "";
      return url.href;
    } catch (_error) {
      return null;
    }
  }

  function isLmStudioProvider(providerId) {
    return (
      globalThis.ZeroLatencyLmStudio?.isLmStudioProvider?.(providerId) === true ||
      String(providerId || "").toLowerCase() === "lmstudio"
    );
  }

  globalThis.ZeroLatencySettingsAiModelProvider = {
    buildModelsRequest,
    deriveOpenAiCompatibleModelsUrl,
    isLmStudioProvider,
  };
})();
