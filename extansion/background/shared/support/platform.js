function hasChromeNamespaceMethod(namespace, method) {
  return typeof globalThis.chrome?.[namespace]?.[method] === "function";
}

function detectPlatformSupport() {
  const userAgent = (globalThis.navigator?.userAgent || "").toLowerCase();
  return {
    windows: userAgent.includes("windows"),
    mac: userAgent.includes("macintosh") || userAgent.includes("mac os"),
    linux: userAgent.includes("linux") && !userAgent.includes("android"),
  };
}
