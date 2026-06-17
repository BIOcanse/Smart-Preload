(() => {
  const constants = globalThis.ZeroLatencyLmStudioConstants;
  const modelApi = globalThis.ZeroLatencyLmStudioModels;
  const httpApi = globalThis.ZeroLatencyLmStudioHttp;

  function isLmStudioProvider(providerId) {
    return String(providerId || "").toLowerCase() === constants.PROVIDER_ID;
  }

  async function listModels(options = {}) {
    const parsed = await httpApi.fetchJson(constants.MODELS_URL, {
      method: "GET",
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? constants.DEFAULT_REQUEST_TIMEOUT_MS,
    });

    return modelApi.normalizeModelListResponse(parsed);
  }

  async function getModelStatus(modelId, options = {}) {
    const normalizedModelId = modelApi.normalizeModelId(modelId);

    if (!normalizedModelId) {
      return null;
    }

    const models = await listModels(options);
    return models.find((model) => model.id === normalizedModelId) ?? null;
  }

  async function loadModel(modelId, options = {}) {
    const normalizedModelId = modelApi.normalizeModelId(modelId);

    if (!normalizedModelId) {
      return { ok: false, reason: "missing-model-id" };
    }

    const body = {
      model: normalizedModelId,
    };

    if (Number.isFinite(Number(options.contextLength)) && Number(options.contextLength) > 0) {
      body.context_length = Math.round(Number(options.contextLength));
    }

    await httpApi.fetchJson(constants.LOAD_MODEL_URL, {
      method: "POST",
      body,
      timeoutMs: options.timeoutMs ?? constants.DEFAULT_LOAD_TIMEOUT_MS,
    });

    return { ok: true, modelId: normalizedModelId };
  }

  async function unloadModel(modelId, options = {}) {
    const normalizedModelId = modelApi.normalizeModelId(modelId);

    if (!normalizedModelId) {
      return { ok: false, reason: "missing-model-id" };
    }

    const status = await getModelStatus(normalizedModelId, options).catch(() => null);

    if (!status?.loaded) {
      return { ok: true, modelId: normalizedModelId, unloaded: false, reason: "not-loaded" };
    }

    const instanceIds =
      status.instanceIds.length > 0 ? status.instanceIds : [normalizedModelId];
    const results = await Promise.allSettled(
      instanceIds.map((instanceId) =>
        httpApi.fetchJson(constants.UNLOAD_MODEL_URL, {
          method: "POST",
          body: { instance_id: instanceId },
          timeoutMs: options.timeoutMs ?? constants.DEFAULT_REQUEST_TIMEOUT_MS,
        })
      )
    );
    const rejected = results.filter((result) => result.status === "rejected");

    return {
      ok: rejected.length === 0,
      modelId: normalizedModelId,
      unloaded: rejected.length === 0,
      attemptedInstanceIds: instanceIds,
      error: rejected[0]?.reason
        ? String(rejected[0].reason?.message || rejected[0].reason)
        : null,
    };
  }

  async function waitForModelLoaded(modelId, options = {}) {
    const normalizedModelId = modelApi.normalizeModelId(modelId);
    const timeoutMs = options.timeoutMs ?? constants.DEFAULT_LOAD_TIMEOUT_MS;
    const pollIntervalMs =
      options.pollIntervalMs ?? constants.DEFAULT_LOAD_POLL_INTERVAL_MS;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      const status = await getModelStatus(normalizedModelId, {
        timeoutMs: options.requestTimeoutMs ?? constants.DEFAULT_REQUEST_TIMEOUT_MS,
      }).catch(() => null);

      if (status?.loaded) {
        return { ok: true, model: status };
      }

      await httpApi.sleep(pollIntervalMs);
    }

    return { ok: false, reason: "timeout", modelId: normalizedModelId };
  }

  globalThis.ZeroLatencyLmStudio = {
    PROVIDER_ID: constants.PROVIDER_ID,
    API_BASE_URL: constants.API_BASE_URL,
    CHAT_COMPLETIONS_URL: constants.CHAT_COMPLETIONS_URL,
    MODELS_URL: constants.MODELS_URL,
    LOAD_MODEL_URL: constants.LOAD_MODEL_URL,
    UNLOAD_MODEL_URL: constants.UNLOAD_MODEL_URL,
    isLmStudioProvider,
    listModels,
    getModelStatus,
    loadModel,
    unloadModel,
    waitForModelLoaded,
    normalizeModelListResponse: modelApi.normalizeModelListResponse,
  };
})();
