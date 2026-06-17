(function () {
  function localize(key, fallback, substitutions = []) {
    if (globalThis.ZeroLatencyI18n?.t) {
      return globalThis.ZeroLatencyI18n.t(key, substitutions, fallback);
    }

    try {
      const message = globalThis.chrome?.i18n?.getMessage?.(key) || "";
      const template = message || fallback || key;
      const values = Array.isArray(substitutions) ? substitutions : [substitutions];
      return String(template).replace(/\{(\d+)\}/g, (match, indexText) => {
        const value = values[Number(indexText)];
        return value == null ? match : String(value);
      });
    } catch (_error) {
      return fallback || key;
    }
  }

  globalThis.ZeroLatencySettingsSchemaLocalize = {
    localize,
  };
})();
