(function () {
  const FNV_64_OFFSET = 0xcbf29ce484222325n;
  const FNV_64_PRIME = 0x100000001b3n;
  const FNV_64_MASK = 0xffffffffffffffffn;

  function normalizeThreatUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);

      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return "";
      }

      url.hash = "";
      return url.href;
    } catch (_error) {
      return "";
    }
  }

  function fingerprintThreatUrl(normalizedUrl) {
    return fingerprintString(String(normalizedUrl || ""));
  }

  function normalizeThreatHostname(rawHostname) {
    return String(rawHostname || "")
      .trim()
      .toLowerCase()
      .replace(/^\[/u, "")
      .replace(/\]$/u, "");
  }

  function fingerprintThreatHost(normalizedHostname) {
    return fingerprintString(normalizeThreatHostname(normalizedHostname));
  }

  function fingerprintString(value) {
    const normalizedValue = String(value || "");
    let hash = FNV_64_OFFSET;

    for (let index = 0; index < normalizedValue.length; index += 1) {
      hash ^= BigInt(normalizedValue.charCodeAt(index));
      hash = (hash * FNV_64_PRIME) & FNV_64_MASK;
    }

    return `${hash.toString(16).padStart(16, "0")}:${normalizedValue.length}`;
  }

  function buildHostSuffixes(hostname) {
    const normalizedHostname = normalizeThreatHostname(hostname);

    if (!normalizedHostname || normalizedHostname.includes(":")) {
      return normalizedHostname ? [normalizedHostname] : [];
    }

    if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(normalizedHostname)) {
      return [normalizedHostname];
    }

    const parts = normalizedHostname.split(".").filter(Boolean);
    const suffixes = [];

    for (let index = 0; index < parts.length - 1; index += 1) {
      suffixes.push(parts.slice(index).join("."));
    }

    return suffixes;
  }

  globalThis.ZeroLatencyThreatDatabaseFingerprint = {
    normalizeThreatUrl,
    normalizeThreatHostname,
    fingerprintThreatUrl,
    fingerprintThreatHost,
    buildHostSuffixes,
  };
})();
