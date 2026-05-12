(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const { constants, normalizeNavigableHref } = namespace;

  function applySpeculationRules({ prerenderTargets = [], prefetchTargets = [] }) {
    const speculationRulesElement = document.getElementById(
      constants.SPECULATION_RULES_ELEMENT_ID
    );
    const serializedRules = buildSpeculationRulesPayload({
      prerenderTargets,
      prefetchTargets,
    });

    if (!serializedRules) {
      speculationRulesElement?.remove();
      return;
    }

    if (!HTMLScriptElement.supports || !HTMLScriptElement.supports("speculationrules")) {
      speculationRulesElement?.remove();
      return;
    }

    if (speculationRulesElement?.textContent === serializedRules) {
      return;
    }

    const nextRulesElement =
      speculationRulesElement instanceof HTMLScriptElement
        ? speculationRulesElement
        : document.createElement("script");
    nextRulesElement.id = constants.SPECULATION_RULES_ELEMENT_ID;
    nextRulesElement.type = "speculationrules";
    nextRulesElement.textContent = serializedRules;
    (document.head || document.documentElement || document.body)?.appendChild(nextRulesElement);
  }

  function isExtensionOnlyMutation(mutation) {
    const target = mutation.target;

    if (target instanceof Element && target.id === constants.SPECULATION_RULES_ELEMENT_ID) {
      return true;
    }

    if (mutation.type !== "childList") {
      return false;
    }

    const touchedNodes = [...mutation.addedNodes, ...mutation.removedNodes];

    if (!touchedNodes.length) {
      return false;
    }

    return touchedNodes.every(
      (node) => node instanceof Element && node.id === constants.SPECULATION_RULES_ELEMENT_ID
    );
  }

  function buildSpeculationRulesPayload({ prerenderTargets, prefetchTargets }) {
    const selfUrls = [];
    const blankUrls = [];
    const prefetchUrls = [];
    const seen = new Set();

    for (const target of Array.isArray(prerenderTargets) ? prerenderTargets : []) {
      const normalizedUrl = normalizeNavigableHref(target?.url);
      const normalizedTargetHint = target?.targetHint === "_blank" ? "_blank" : "_self";

      if (!normalizedUrl || seen.has(`${normalizedTargetHint}|${normalizedUrl}`)) {
        continue;
      }

      seen.add(`${normalizedTargetHint}|${normalizedUrl}`);

      if (normalizedTargetHint === "_blank") {
        blankUrls.push(normalizedUrl);
      } else {
        selfUrls.push(normalizedUrl);
      }
    }

    for (const target of Array.isArray(prefetchTargets) ? prefetchTargets : []) {
      const normalizedUrl = normalizeNavigableHref(target?.url);

      if (!normalizedUrl || seen.has(`prefetch|${normalizedUrl}`)) {
        continue;
      }

      seen.add(`prefetch|${normalizedUrl}`);
      prefetchUrls.push(normalizedUrl);
    }

    const prerenderRules = [];

    if (selfUrls.length) {
      prerenderRules.push({ urls: selfUrls });
    }

    if (blankUrls.length) {
      prerenderRules.push({
        urls: blankUrls,
        target_hint: "_blank",
      });
    }

    const payload = {};

    if (prerenderRules.length) {
      payload.prerender = prerenderRules;
    }

    if (prefetchUrls.length) {
      payload.prefetch = [{ urls: prefetchUrls }];
    }

    return Object.keys(payload).length ? JSON.stringify(payload) : null;
  }

  Object.assign(namespace, {
    applySpeculationRules,
    isExtensionOnlyMutation,
  });
})();
