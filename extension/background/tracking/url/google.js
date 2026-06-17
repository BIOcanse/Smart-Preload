const GOOGLE_INTERNAL_EXACT_HOSTS = new Set([
  "chromewebstore.google.com",
  "accounts.google.com",
  "myaccount.google.com",
  "passwords.google.com",
  "chromestatus.com",
  "support.google.com",
  "policies.google.com",
  "about.google",
]);

function getGoogleSearchNode(parsedUrl) {
  const isGoogleHost =
    parsedUrl.hostname === "google.com" ||
    parsedUrl.hostname === "www.google.com" ||
    parsedUrl.hostname.startsWith("google.") ||
    parsedUrl.hostname.startsWith("www.google.");
  const isSearchPath = parsedUrl.pathname === "/search";
  const hasQuery = parsedUrl.searchParams.has("q");

  if (!isGoogleHost || !isSearchPath || !hasQuery) {
    return null;
  }

  return {
    nodeId: `${parsedUrl.origin}/search`,
    origin: parsedUrl.origin,
    host: `${parsedUrl.host}/search`,
    hostname: parsedUrl.hostname,
    protocol: parsedUrl.protocol.replace(":", ""),
    sampleUrl: `${parsedUrl.origin}/search`,
  };
}

function isGoogleSearchNodeId(nodeId) {
  return /google\.[^/]+\/search$/.test(nodeId);
}

function isGoogleInternalPageUrl(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    const hostname = parsedUrl.hostname.toLowerCase();

    if (hostname === "gemini.google.com") {
      return false;
    }

    if (GOOGLE_INTERNAL_EXACT_HOSTS.has(hostname)) {
      return true;
    }

    if (hostname === "chrome.google.com") {
      const pathname = parsedUrl.pathname.toLowerCase();
      return pathname.startsWith("/webstore") || pathname.startsWith("/sync");
    }

    return false;
  } catch (_error) {
    return false;
  }
}

function normalizeGoogleTrackedPageUrl(parsedUrl) {
  const googleSearchNode = getGoogleSearchNode(parsedUrl);

  if (!googleSearchNode) {
    return;
  }

  parsedUrl.search = "";
}
