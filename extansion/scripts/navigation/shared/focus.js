(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});

  function hasActiveEditableFocus() {
    const activeElement = document.activeElement;

    if (!(activeElement instanceof HTMLElement)) {
      return false;
    }

    if (activeElement.isContentEditable) {
      return true;
    }

    if (activeElement instanceof HTMLTextAreaElement) {
      return true;
    }

    if (activeElement instanceof HTMLInputElement) {
      const interactiveTypes = new Set([
        "text",
        "search",
        "email",
        "number",
        "password",
        "tel",
        "url",
      ]);

      return interactiveTypes.has((activeElement.type || "text").toLowerCase());
    }

    return false;
  }

  function isPassivePrerenderContext() {
    return document.prerendering === true;
  }

  Object.assign(namespace, {
    hasActiveEditableFocus,
    isPassivePrerenderContext,
  });
})();
