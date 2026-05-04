(() => {
  const PROVIDER_ID = "lmstudio";
  const API_BASE_URL = "http://127.0.0.1:1234";
  const CHAT_COMPLETIONS_URL = `${API_BASE_URL}/v1/chat/completions`;
  const MODELS_URL = `${API_BASE_URL}/api/v1/models`;
  const LOAD_MODEL_URL = `${API_BASE_URL}/api/v1/models/load`;
  const UNLOAD_MODEL_URL = `${API_BASE_URL}/api/v1/models/unload`;
  const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
  const DEFAULT_LOAD_TIMEOUT_MS = 120_000;
  const DEFAULT_LOAD_POLL_INTERVAL_MS = 1_500;

  function isLmStudioProvider(providerId) {
    return String(providerId || "").toLowerCase() === PROVIDER_ID;
  }

  async function listModels(options = {}) {
    const parsed = await fetchJson(MODELS_URL, {
      method: "GET",
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    });

    return normalizeModelListResponse(parsed);
  }

  async function getModelStatus(modelId, options = {}) {
    const normalizedModelId = normalizeModelId(modelId);

    if (!normalizedModelId) {
      return null;
    }

    const models = await listModels(options);
    return models.find((model) => model.id === normalizedModelId) ?? null;
  }

  async function loadModel(modelId, options = {}) {
    const normalizedModelId = normalizeModelId(modelId);

    if (!normalizedModelId) {
      return { ok: false, reason: "missing-model-id" };
    }

    const body = {
      model: normalizedModelId,
    };

    if (Number.isFinite(Number(options.contextLength)) && Number(options.contextLength) > 0) {
      body.context_length = Math.round(Number(options.contextLength));
    }

    await fetchJson(LOAD_MODEL_URL, {
      method: "POST",
      body,
      timeoutMs: options.timeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS,
    });

    return { ok: true, modelId: normalizedModelId };
  }

  async function unloadModel(modelId, options = {}) {
    const normalizedModelId = normalizeModelId(modelId);

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
        fetchJson(UNLOAD_MODEL_URL, {
          method: "POST",
          body: { instance_id: instanceId },
          timeoutMs: options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
        })
      )
    );
    const rejected = results.filter((result) => result.status === "rejected");

    return {
      ok: rejected.length === 0,
      modelId: normalizedModelId,
      unloaded: rejected.length === 0,
      attemptedInstanceIds: instanceIds,
      error: rejected[0]?.reason ? String(rejected[0].reason?.message || rejected[0].reason) : null,
    };
  }

  async function waitForModelLoaded(modelId, options = {}) {
    const normalizedModelId = normalizeModelId(modelId);
    const timeoutMs = options.timeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_LOAD_POLL_INTERVAL_MS;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      const status = await getModelStatus(normalizedModelId, {
        timeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      }).catch(() => null);

      if (status?.loaded) {
        return { ok: true, model: status };
      }

      await sleep(pollIntervalMs);
    }

    return { ok: false, reason: "timeout", modelId: normalizedModelId };
  }

  function normalizeModelListResponse(parsed) {
    const rawModels = Array.isArray(parsed?.models)
      ? parsed.models
      : Array.isArray(parsed?.data)
        ? parsed.data
        : [];

    return rawModels
      .map(normalizeModel)
      .filter(Boolean)
      .sort(compareModels);
  }

  function normalizeModel(rawModel) {
    if (!rawModel || typeof rawModel !== "object") {
      return null;
    }

    const type = typeof rawModel.type === "string" ? rawModel.type.trim().toLowerCase() : "llm";

    if (type && type !== "llm") {
      return null;
    }

    const id = normalizeModelId(rawModel.key || rawModel.id || rawModel.model);

    if (!id) {
      return null;
    }

    const label = normalizeLabel(
      rawModel.display_name || rawModel.displayName || rawModel.name || id
    );
    const instanceIds = normalizeLoadedInstanceIds(rawModel, id);
    const loaded = instanceIds.length > 0 || rawModel.loaded === true;

    return {
      id,
      label,
      type: "llm",
      loaded,
      statusLabel: loaded ? "loaded" : "not loaded",
      instanceIds,
      raw: rawModel,
    };
  }

  function normalizeLoadedInstanceIds(rawModel, modelId) {
    const rawInstances =
      rawModel.loaded_instances ??
      rawModel.loadedInstances ??
      rawModel.instances ??
      rawModel.loadedInstancesInfo ??
      [];

    if (!Array.isArray(rawInstances)) {
      return rawModel.loaded === true ? [modelId] : [];
    }

    return rawInstances
      .map((instance) => {
        if (typeof instance === "string") {
          return instance.trim();
        }

        return normalizeModelId(
          instance?.instance_id ||
            instance?.instanceId ||
            instance?.identifier ||
            instance?.id ||
            modelId
        );
      })
      .filter(Boolean);
  }

  function compareModels(left, right) {
    if (left.loaded !== right.loaded) {
      return left.loaded ? -1 : 1;
    }

    return String(left.label || left.id).localeCompare(String(right.label || right.id));
  }

  async function fetchJson(url, options = {}) {
    const timeoutMs = Number(options.timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS;
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
        throw new Error(`LM Studio responded with HTTP ${response.status}: ${responseText.slice(0, 200)}`);
      }

      return responseText ? JSON.parse(responseText) : {};
    } finally {
      clearTimeout(timeoutId);
      options.signal?.removeEventListener?.("abort", abortExternalSignal);
    }
  }

  function normalizeModelId(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeLabel(value) {
    return typeof value === "string" && value.trim() ? value.trim() : "Local model";
  }

  function sleep(delayMs) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  globalThis.ZeroLatencyLmStudio = {
    PROVIDER_ID,
    API_BASE_URL,
    CHAT_COMPLETIONS_URL,
    MODELS_URL,
    LOAD_MODEL_URL,
    UNLOAD_MODEL_URL,
    isLmStudioProvider,
    listModels,
    getModelStatus,
    loadModel,
    unloadModel,
    waitForModelLoaded,
    normalizeModelListResponse,
  };
})();
