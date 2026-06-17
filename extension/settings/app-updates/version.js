(() => {
  function normalizeVersion(value) {
    const text = String(value || "")
      .trim()
      .replace(/^v/iu, "");
    return /^\d+\.\d+\.\d+$/u.test(text) ? text : "";
  }

  function compareVersions(left, right) {
    const leftParts = String(left || "").split(".").map((part) => Number(part) || 0);
    const rightParts = String(right || "").split(".").map((part) => Number(part) || 0);

    for (let index = 0; index < 3; index += 1) {
      if (leftParts[index] !== rightParts[index]) {
        return leftParts[index] - rightParts[index];
      }
    }

    return 0;
  }

  globalThis.ZeroLatencySettingsAppUpdateVersion = {
    normalizeVersion,
    compareVersions,
  };
})();
