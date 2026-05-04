(function () {
  const OPENAI_COMPATIBLE_PROVIDERS = new Set([
    "openai",
    "grok",
    "deepseek",
    "qwen",
    "glm",
    "kimi",
    "openrouter",
    "lmstudio",
  ]);
  const DEFAULT_AI_TIMEOUT_MS = 45_000;
  const LM_STUDIO_MODEL_POLL_TIMEOUT_MS = 120_000;
  const LM_STUDIO_LIFECYCLE_ALARM = "ai-lmstudio-lifecycle-watchdog";
  const LM_STUDIO_LIFECYCLE_INTERVAL_SECONDS = 1;
  const NON_CHROME_FULLSCREEN_UNLOAD_AFTER_MS = 5_000;
  const ACTIVITY_QUERY_FAILURE_UNLOAD_THRESHOLD = 3;
  let lmStudioLoadState = {
    modelId: "",
    promise: null,
  };
  let nonChromeFullscreenSinceAt = null;
  let activityQueryFailureCount = 0;

  async function invokeConfiguredAiProvider(settings, prompt, options = {}) {
    const request = buildAiProviderRequest(settings, prompt, options);

    if (!request) {
      return null;
    }

    if (isLmStudioProvider(request.providerId)) {
      const ready = await ensureLmStudioModelReady(request.modelId);

      if (!ready) {
        return null;
      }
    }

    const response = await fetchWithTimeout(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      timeoutMs: options.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS,
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        `AI provider ${request.providerId} failed with HTTP ${response.status}: ${responseText.slice(0, 300)}`
      );
    }

    return {
      output_text: extractProviderOutputText(request.providerId, responseText),
      provider_id: request.providerId,
      model_id: request.modelId,
    };
  }

  function buildAiProviderRequest(settings, prompt, options = {}) {
    const promptText = typeof prompt === "string" ? prompt.trim() : "";
    const settingsApi = globalThis.ZeroLatencySettings;
    const aiPrediction = settings?.preloading?.aiPrediction ?? {};
    const providerId = normalizeProviderId(aiPrediction.providerId);
    const provider = settingsApi?.AI_PROVIDER_BY_ID?.[providerId];
    const modelId =
      typeof aiPrediction.modelId === "string" && aiPrediction.modelId.trim()
        ? aiPrediction.modelId.trim()
        : typeof aiPrediction.modelIds?.[providerId] === "string"
          ? aiPrediction.modelIds[providerId].trim()
          : "";
    const endpointUrl =
      typeof aiPrediction.endpointUrls?.[providerId] === "string"
        ? aiPrediction.endpointUrls[providerId].trim()
        : provider?.endpointUrl || "";
    const apiKey =
      typeof aiPrediction.apiKeys?.[providerId] === "string"
        ? aiPrediction.apiKeys[providerId].trim()
        : "";
    const modelInfo =
      typeof settingsApi?.getAiModelInfo === "function"
        ? settingsApi.getAiModelInfo(providerId, modelId)
        : null;
    const requestParams =
      typeof settingsApi?.getAiRequestParams === "function"
        ? settingsApi.getAiRequestParams(providerId, modelId)
        : {};
    const resolvedModelId =
      typeof modelInfo?.id === "string" && modelInfo.id.trim()
        ? modelInfo.id.trim()
        : modelId;

    if (!provider || !promptText || !modelId || !endpointUrl) {
      return null;
    }

    if (!apiKey && provider.apiKeyOptional !== true) {
      return null;
    }

    if (providerId === "gemini") {
      return buildGeminiRequest({
        providerId,
        modelId: resolvedModelId,
        endpointUrl,
        apiKey,
        promptText,
        requestParams,
        responseFormat: options.responseFormat,
      });
    }

    if (providerId === "claude") {
      return buildClaudeRequest({
        providerId,
        modelId: resolvedModelId,
        endpointUrl,
        apiKey,
        promptText,
        requestParams,
      });
    }

    if (OPENAI_COMPATIBLE_PROVIDERS.has(providerId)) {
      return buildOpenAiCompatibleRequest({
        providerId,
        modelId: resolvedModelId,
        endpointUrl,
        apiKey,
        promptText,
        requestParams,
        responseFormat: options.responseFormat,
      });
    }

    return null;
  }

  function buildOpenAiCompatibleRequest({
    providerId,
    modelId,
    endpointUrl,
    apiKey,
    promptText,
    requestParams,
    responseFormat,
  }) {
    const headers = {
      "content-type": "application/json",
    };

    if (apiKey && !isLmStudioProvider(providerId)) {
      headers.authorization = `Bearer ${apiKey}`;
    }

    if (providerId === "openrouter") {
      headers["x-title"] = "Zero-Latency Web";
    }

    const body = {
      model: modelId,
      messages: [
        {
          role: "user",
          content: promptText,
        },
      ],
    };
    applyCommonOpenAiCompatibleParams(body, requestParams);

    if (shouldRequestJson(responseFormat, requestParams)) {
      body.response_format = { type: "json_object" };
    }

    return {
      providerId,
      modelId,
      url: endpointUrl,
      headers,
      body,
    };
  }

  async function ensureLmStudioModelReady(modelId) {
    const lmStudio = globalThis.ZeroLatencyLmStudio;
    const normalizedModelId = typeof modelId === "string" ? modelId.trim() : "";

    if (!normalizedModelId || typeof lmStudio?.getModelStatus !== "function") {
      return false;
    }

    const status = await lmStudio.getModelStatus(normalizedModelId).catch(() => null);

    if (status?.loaded) {
      return true;
    }

    startLmStudioModelLoad(normalizedModelId);
    return false;
  }

  function startLmStudioModelLoad(modelId) {
    const lmStudio = globalThis.ZeroLatencyLmStudio;

    if (typeof lmStudio?.loadModel !== "function") {
      return null;
    }

    if (lmStudioLoadState.modelId === modelId && lmStudioLoadState.promise) {
      return lmStudioLoadState.promise;
    }

    lmStudioLoadState = {
      modelId,
      promise: (async () => {
        await lmStudio.loadModel(modelId, { timeoutMs: LM_STUDIO_MODEL_POLL_TIMEOUT_MS });
        return await lmStudio.waitForModelLoaded(modelId, {
          timeoutMs: LM_STUDIO_MODEL_POLL_TIMEOUT_MS,
        });
      })()
        .catch((error) => {
          globalThis.ZeroLatencyDebugEvents?.record?.("ai.lmstudio.load.error", {
            modelId,
            error: String(error?.message || error),
          });
          return { ok: false, error: String(error?.message || error) };
        })
        .finally(() => {
          if (lmStudioLoadState.modelId === modelId) {
            lmStudioLoadState = {
              modelId: "",
              promise: null,
            };
          }
        }),
    };

    return lmStudioLoadState.promise;
  }

  async function unloadConfiguredLmStudioModel(settings, reason = "runtime-inactive") {
    const lmStudio = globalThis.ZeroLatencyLmStudio;
    const aiPrediction = settings?.preloading?.aiPrediction ?? {};
    const modelId = typeof aiPrediction.modelId === "string" ? aiPrediction.modelId.trim() : "";

    if (
      !isLmStudioProvider(aiPrediction.providerId) ||
      !modelId ||
      typeof lmStudio?.unloadModel !== "function"
    ) {
      return { ok: true, skipped: true, reason: "not-lmstudio" };
    }

    try {
      const result = await lmStudio.unloadModel(modelId);
      globalThis.ZeroLatencyDebugEvents?.record?.("ai.lmstudio.unload", {
        ok: result?.ok === true,
        modelId,
        reason,
      });
      return result;
    } catch (error) {
      globalThis.ZeroLatencyDebugEvents?.record?.("ai.lmstudio.unload.error", {
        modelId,
        reason,
        error: String(error?.message || error),
      });
      return { ok: false, error: String(error?.message || error) };
    }
  }

  async function ensureLmStudioLifecycleWatchdog(settings, options = {}) {
    if (globalThis.ZeroLatencySupport?.hasChromeNamespaceMethod?.("alarms", "create") !== true) {
      return;
    }

    if (options.forceDisabled === true || !isLmStudioRuntimeEnabled(settings)) {
      await chrome.alarms.clear(LM_STUDIO_LIFECYCLE_ALARM);
      nonChromeFullscreenSinceAt = null;
      return;
    }

    const periodInMinutes = LM_STUDIO_LIFECYCLE_INTERVAL_SECONDS / 60;

    await chrome.alarms.create(LM_STUDIO_LIFECYCLE_ALARM, {
      delayInMinutes: periodInMinutes,
      periodInMinutes,
    });
  }

  async function maintainLmStudioModelLifecycle(settings = getEffectiveExtensionSettings()) {
    if (!isLmStudioRuntimeEnabled(settings)) {
      await unloadConfiguredLmStudioModel(settings, "lmstudio-runtime-inactive");
      await ensureLmStudioLifecycleWatchdog(settings);
      return;
    }

    const activity = await fetchNativeApp("/api/v1/system/activity", {
      method: "GET",
      timeoutMs: 1_500,
    }).catch(() => null);

    if (!activity || typeof activity !== "object") {
      activityQueryFailureCount += 1;

      if (activityQueryFailureCount >= ACTIVITY_QUERY_FAILURE_UNLOAD_THRESHOLD) {
        await unloadConfiguredLmStudioModel(settings, "activity-query-unavailable");
      }

      return;
    }

    activityQueryFailureCount = 0;

    if (activity?.chromeRunning === false) {
      await unloadConfiguredLmStudioModel(settings, "chrome-not-running");
      return;
    }

    if (activity?.nonChromeFullscreen === true) {
      nonChromeFullscreenSinceAt = nonChromeFullscreenSinceAt ?? Date.now();

      if (Date.now() - nonChromeFullscreenSinceAt >= NON_CHROME_FULLSCREEN_UNLOAD_AFTER_MS) {
        await unloadConfiguredLmStudioModel(settings, "non-chrome-fullscreen");
      }

      return;
    }

    nonChromeFullscreenSinceAt = null;
  }

  function isLmStudioLifecycleAlarm(alarmName) {
    return alarmName === LM_STUDIO_LIFECYCLE_ALARM;
  }

  function isLmStudioRuntimeEnabled(settings) {
    const aiPrediction = settings?.preloading?.aiPrediction ?? {};

    return (
      settings?.preloading?.enabled === true &&
      aiPrediction.enabled === true &&
      isLmStudioProvider(aiPrediction.providerId) &&
      typeof aiPrediction.modelId === "string" &&
      aiPrediction.modelId.trim().length > 0
    );
  }

  function isLmStudioProvider(providerId) {
    return (
      globalThis.ZeroLatencyLmStudio?.isLmStudioProvider?.(providerId) === true ||
      String(providerId || "").toLowerCase() === "lmstudio"
    );
  }

  function buildGeminiRequest({
    providerId,
    modelId,
    endpointUrl,
    apiKey,
    promptText,
    requestParams,
    responseFormat,
  }) {
    const generationConfig = {};
    applyFiniteNumberParam(generationConfig, "temperature", requestParams?.temperature);

    if (shouldRequestJson(responseFormat, requestParams)) {
      generationConfig.responseMimeType =
        typeof requestParams?.responseMimeType === "string" && requestParams.responseMimeType
          ? requestParams.responseMimeType
          : "application/json";
    }

    if (Number.isFinite(Number(requestParams?.thinkingBudget))) {
      generationConfig.thinkingConfig = {
        thinkingBudget: Math.max(0, Math.round(Number(requestParams.thinkingBudget))),
      };
    }

    return {
      providerId,
      modelId,
      url: endpointUrl.replace("{model}", encodeURIComponent(modelId)),
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: {
        contents: [
          {
            role: "user",
            parts: [{ text: promptText }],
          },
        ],
        generationConfig,
      },
    };
  }

  function buildClaudeRequest({
    providerId,
    modelId,
    endpointUrl,
    apiKey,
    promptText,
    requestParams,
  }) {
    const body = {
      model: modelId,
      messages: [
        {
          role: "user",
          content: promptText,
        },
      ],
    };
    const maxTokens = resolveMaxTokens(requestParams);

    if (maxTokens) {
      body.max_tokens = maxTokens;
    }

    applyFiniteNumberParam(body, "temperature", requestParams?.temperature);

    return {
      providerId,
      modelId,
      url: endpointUrl,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body,
    };
  }

  function applyCommonOpenAiCompatibleParams(body, requestParams) {
    const maxTokens = resolveMaxTokens(requestParams);

    applyFiniteNumberParam(body, "temperature", requestParams?.temperature);

    if (maxTokens) {
      body.max_tokens = maxTokens;
    }

    if (typeof requestParams?.reasoningEffort === "string" && requestParams.reasoningEffort) {
      body.reasoning_effort = requestParams.reasoningEffort;
    }

    if (Object.prototype.hasOwnProperty.call(requestParams ?? {}, "enableThinking")) {
      body.enable_thinking = Boolean(requestParams.enableThinking);
    }

    if (isPlainObject(requestParams?.reasoning)) {
      body.reasoning = { ...requestParams.reasoning };
    }
  }

  function shouldRequestJson(responseFormat, requestParams) {
    return responseFormat === "json" && requestParams?.responseFormatJson !== false;
  }

  function resolveMaxTokens(requestParams) {
    const maxTokens = Number(requestParams?.maxTokens);

    if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
      return 512;
    }

    return Math.round(maxTokens);
  }

  function applyFiniteNumberParam(body, key, value) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return;
    }

    body[key] = numericValue;
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  async function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timeoutMs = Number(options?.timeoutMs) || DEFAULT_AI_TIMEOUT_MS;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function extractProviderOutputText(providerId, responseText) {
    const parsed = JSON.parse(responseText);

    if (providerId === "gemini") {
      return (
        parsed?.candidates?.[0]?.content?.parts
          ?.map((part) => (typeof part?.text === "string" ? part.text : ""))
          .filter(Boolean)
          .join("\n") || ""
      );
    }

    if (providerId === "claude") {
      return (
        parsed?.content
          ?.map((part) => (typeof part?.text === "string" ? part.text : ""))
          .filter(Boolean)
          .join("\n") || ""
      );
    }

    return parsed?.choices?.[0]?.message?.content || parsed?.choices?.[0]?.text || "";
  }

  function normalizeProviderId(value) {
    const settingsApi = globalThis.ZeroLatencySettings;
    return settingsApi?.AI_PROVIDER_VALUES?.includes(value)
      ? value
      : settingsApi?.DEFAULT_SETTINGS?.preloading?.aiPrediction?.providerId || "deepseek";
  }

  globalThis.ZeroLatencyAiProviders = {
    LM_STUDIO_LIFECYCLE_ALARM,
    buildAiProviderRequest,
    invokeConfiguredAiProvider,
    unloadConfiguredLmStudioModel,
    ensureLmStudioLifecycleWatchdog,
    maintainLmStudioModelLifecycle,
    isLmStudioLifecycleAlarm,
  };
})();
