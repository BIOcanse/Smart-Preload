(function () {
  const providerModules = globalThis.ZeroLatencyAiProviderModules || {};
  const {
    DEFAULT_AI_TIMEOUT_MS,
    buildAiProviderRequest,
    extractProviderOutputText,
    fetchWithTimeout,
    isLmStudioProvider,
    ensureLmStudioModelReady,
    unloadConfiguredLmStudioModel,
    ensureLmStudioLifecycleWatchdog,
    maintainLmStudioModelLifecycle,
    isLmStudioLifecycleAlarm,
    LM_STUDIO_LIFECYCLE_ALARM,
  } = providerModules;

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
