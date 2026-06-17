const PRELOAD_CANDIDATE_COLLECTION_MESSAGE_TIMEOUT_MS = 750;

async function sendPreloadCandidateCollectionMessage(tabId, reason) {
  const normalizedTabId = normalizePositiveInteger(tabId);

  if (normalizedTabId === null) {
    throw new Error("invalid-tab-id");
  }

  const result = await Promise.race([
    chrome.tabs
      .sendMessage(normalizedTabId, {
        type: "preload:collect-candidates",
      })
      .then(
        () => ({ ok: true }),
        (error) => ({
          ok: false,
          error,
        })
      ),
    new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          ok: false,
          timedOut: true,
          error: new Error("preload collect-candidates message timed out"),
        });
      }, PRELOAD_CANDIDATE_COLLECTION_MESSAGE_TIMEOUT_MS);
    }),
  ]);

  if (result?.ok === true) {
    return;
  }

  globalThis.ZeroLatencyDebugEvents?.record?.("preload-candidates.collect-message.failed", {
    tabId: normalizedTabId,
    reason,
    timedOut: result?.timedOut === true,
    error:
      result?.error instanceof Error
        ? result.error.message
        : String(result?.error || "unknown"),
  });
  throw result?.error ?? new Error("preload collect-candidates message failed");
}
