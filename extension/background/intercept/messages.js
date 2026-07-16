(function () {
  function createMessageEnvelope(message, sender) {
    if (!message || typeof message.type !== "string") {
      return null;
    }

    const sourceTab = sender?.tab ?? null;
    const fromExtensionUi = isExtensionUiSender(sender, sourceTab);

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
        fromExtensionUi,
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

  function isExtensionUiSender(sender, sourceTab) {
    const runtime = globalThis.chrome?.runtime;
    const extensionRoot = runtime?.getURL?.("") || "";
    const senderUrl =
      typeof sender?.url === "string" && sender.url
        ? sender.url
        : typeof sourceTab?.url === "string"
          ? sourceTab.url
          : "";

    if (extensionRoot && senderUrl.startsWith(extensionRoot)) {
      return !sender?.id || !runtime?.id || sender.id === runtime.id;
    }

    // Popup and other extension views may not have an associated browser tab.
    return !sourceTab?.id && (!sender?.id || !runtime?.id || sender.id === runtime.id);
  }

  globalThis.ZeroLatencyMessageIntercept = {
    createMessageEnvelope,
    isExtensionUiSender,
  };
})();
