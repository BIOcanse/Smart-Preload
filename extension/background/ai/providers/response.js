(function () {
  const namespace = (globalThis.ZeroLatencyAiProviderModules =
    globalThis.ZeroLatencyAiProviderModules || {});

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

  Object.assign(namespace, {
    extractProviderOutputText,
  });
})();
