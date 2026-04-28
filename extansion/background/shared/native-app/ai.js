async function nativeAppGetAiStatus() {
  return fetchNativeApp("/api/v1/ai/status", {
    method: "GET",
    timeoutMs: 10_000,
  });
}

async function nativeAppInstallAiModel(modelId) {
  return fetchNativeApp("/api/v1/ai/models/install", {
    method: "POST",
    body: { model_id: modelId },
    timeoutMs: 60 * 60 * 1000,
  });
}

async function nativeAppUninstallAiModel(modelId) {
  return fetchNativeApp("/api/v1/ai/models/uninstall", {
    method: "POST",
    body: { model_id: modelId },
    timeoutMs: 10 * 60 * 1000,
  });
}

async function nativeAppInvokeAiModel(payload) {
  return fetchNativeApp("/api/v1/ai/infer", {
    method: "POST",
    body: payload,
    timeoutMs: 10 * 60 * 1000,
  });
}

async function nativeAppGetAiProgress() {
  return fetchNativeApp("/api/v1/ai/progress", {
    method: "GET",
    timeoutMs: 5_000,
  });
}
