function derivePageLabel(pageUrl) {
  try {
    const parsedUrl = new URL(normalizePageUrlForIndex(pageUrl) || pageUrl);
    const path = parsedUrl.pathname === "/" ? "" : parsedUrl.pathname;
    return `${parsedUrl.host}${path}${parsedUrl.search}` || pageUrl;
  } catch (_error) {
    return pageUrl;
  }
}


function normalizePageUrlForIndex(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }

    parsedUrl.hash = "";
    normalizeGoogleTrackedPageUrl(parsedUrl);
    return parsedUrl.href;
  } catch (_error) {
    return null;
  }
}

function isSameOriginUrl(leftUrl, rightUrl) {
  try {
    return new URL(leftUrl).origin === new URL(rightUrl).origin;
  } catch (_error) {
    return false;
  }
}

function buildNodeSeed(rawUrl) {
  const parsedUrl = new URL(rawUrl);
  const googleSearchNode = getEffectiveExtensionSettings().tracking.trackGoogleSearchPages
    ? getGoogleSearchNode(parsedUrl)
    : null;

  if (googleSearchNode) {
    return googleSearchNode;
  }

  return {
    nodeId: parsedUrl.origin,
    origin: parsedUrl.origin,
    host: parsedUrl.host,
    hostname: parsedUrl.hostname,
    protocol: parsedUrl.protocol.replace(":", ""),
    sampleUrl: rawUrl,
  };
}

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

function isTrackableUrl(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch (_error) {
    return false;
  }
}

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

function isExcludedGooglePage(rawUrl) {
  if (!getEffectiveExtensionSettings().tracking.excludeGoogleInternalPages) {
    return false;
  }
  return isGoogleInternalPageUrl(rawUrl);
}

function isTrackableAndAllowedUrl(rawUrl) {
  return isTrackableUrl(rawUrl) && !isExcludedGooglePage(rawUrl);
}

function normalizeNavigableUrl(rawUrl, baseUrl) {
  try {
    const parsedUrl = new URL(rawUrl, baseUrl);

    if (!isTrackableUrl(parsedUrl.href)) {
      return null;
    }

    const normalizedSourceUrl = new URL(baseUrl);
    normalizedSourceUrl.hash = "";
    const normalizedTargetUrl = new URL(parsedUrl.href);
    normalizedTargetUrl.hash = "";

    if (normalizedSourceUrl.href === normalizedTargetUrl.href) {
      return null;
    }

    return parsedUrl.href;
  } catch (_error) {
    return null;
  }
}

function deriveNodeLabel(nodeId) {
  if (!nodeId) {
    return "Unknown";
  }

  try {
    const url = new URL(nodeId);
    return url.pathname === "/search" ? `${url.host}/search` : url.host;
  } catch (_error) {
    return nodeId;
  }
}

function normalizeGoogleTrackedPageUrl(parsedUrl) {
  const isGoogleHost =
    parsedUrl.hostname === "google.com" ||
    parsedUrl.hostname === "www.google.com" ||
    parsedUrl.hostname.startsWith("google.") ||
    parsedUrl.hostname.startsWith("www.google.");
  const isSearchPath = parsedUrl.pathname === "/search";
  const hasQuery = parsedUrl.searchParams.has("q");

  if (!isGoogleHost || !isSearchPath || !hasQuery) {
    return;
  }

  parsedUrl.search = "";
}
