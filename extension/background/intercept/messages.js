(function () {
  function createMessageEnvelope(message, sender) {
    if (!message || typeof message.type !== "string") {
      return null;
    }

    const sourceTab = sender?.tab ?? null;

    return {
      kind: "runtime-message",
      phase: "pre",
      messageType: message.type,
      source: {
        tabId: sourceTab?.id ?? null,
        windowId: sourceTab?.windowId ?? null,
        pageUrl: sourceTab?.url ?? null,
      },
      target: {
        url:
          typeof message.url === "string"
            ? message.url
            : typeof message.targetUrl === "string"
              ? message.targetUrl
              : null,
        pageUrl:
          typeof message.pageUrl === "string"
            ? message.pageUrl
            : typeof message.sourcePageUrl === "string"
              ? message.sourcePageUrl
              : null,
        modelId: typeof message.modelId === "string" ? message.modelId : null,
      },
      context: {
        fromExtensionUi: !sourceTab?.id,
        hasSenderTab: Boolean(sourceTab?.id),
        fromPreloadRuntime:
          globalThis.isKnownPreloadContext?.(sourceTab?.id ?? null, sourceTab?.windowId ?? null) ===
          true,
        openInNewTab: message?.openInNewTab === true,
      },
      raw: {
        message,
        sender,
      },
    };
  }

  globalThis.ZeroLatencyMessageIntercept = {
    createMessageEnvelope,
  };
})();
