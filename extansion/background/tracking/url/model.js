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

function isLocalPageUrl(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    const hostname = normalizeLocalHostname(parsedUrl.hostname);

    return (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      isIpv4LoopbackHostname(hostname)
    );
  } catch (_error) {
    return false;
  }
}

function isPrivateNetworkPageUrl(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    const hostname = normalizeLocalHostname(parsedUrl.hostname);

    return isIpv4PrivateNetworkHostname(hostname) || isIpv6PrivateNetworkHostname(hostname);
  } catch (_error) {
    return false;
  }
}

function normalizeLocalHostname(hostname) {
  return String(hostname || "")
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "");
}

function isIpv4LoopbackHostname(hostname) {
  const parts = parseIpv4Hostname(hostname);

  if (!parts || parts[0] !== 127) {
    return false;
  }

  return true;
}

function isIpv4PrivateNetworkHostname(hostname) {
  const parts = parseIpv4Hostname(hostname);

  if (!parts) {
    return false;
  }

  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254)
  );
}

function parseIpv4Hostname(hostname) {
  const parts = String(hostname || "").split(".");

  if (parts.length !== 4) {
    return null;
  }

  const values = [];

  for (const part of parts) {
    if (!/^\d+$/u.test(part)) {
      return null;
    }

    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      return null;
    }

    values.push(value);
  }

  return values;
}

function isIpv6PrivateNetworkHostname(hostname) {
  const normalizedHostname = normalizeLocalHostname(hostname);

  if (!normalizedHostname.includes(":")) {
    return false;
  }

  const firstHextetText = normalizedHostname.split(":")[0];
  if (!/^[\da-f]{1,4}$/u.test(firstHextetText)) {
    return false;
  }

  const firstHextet = Number.parseInt(firstHextetText, 16);
  return (firstHextet & 0xfe00) === 0xfc00 || (firstHextet & 0xffc0) === 0xfe80;
}

function isExcludedGooglePage(rawUrl) {
  if (!getEffectiveExtensionSettings().tracking.excludeGoogleInternalPages) {
    return false;
  }
  return isGoogleInternalPageUrl(rawUrl);
}

function isExcludedLocalPage(rawUrl) {
  if (!getEffectiveExtensionSettings().tracking.excludeLocalPages) {
    return false;
  }
  return isLocalPageUrl(rawUrl);
}

function isExcludedPrivateNetworkPage(rawUrl) {
  if (!getEffectiveExtensionSettings().tracking.excludePrivateNetworkPages) {
    return false;
  }
  return isPrivateNetworkPageUrl(rawUrl);
}

function isExcludedTrackingPage(rawUrl) {
  return (
    isExcludedGooglePage(rawUrl) ||
    isExcludedLocalPage(rawUrl) ||
    isExcludedPrivateNetworkPage(rawUrl)
  );
}

function isTrackableAndAllowedUrl(rawUrl) {
  return isTrackableUrl(rawUrl) && !isExcludedTrackingPage(rawUrl);
}

function normalizeNavigableUrl(rawUrl, baseUrl) {
  try {
    const parsedUrl = new URL(rawUrl, baseUrl);

    if (!isTrackableAndAllowedUrl(parsedUrl.href)) {
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
