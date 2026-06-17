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

function isTrackableUrl(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
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

function isExcludedHttpPage(rawUrl) {
  if (!getEffectiveExtensionSettings().tracking.excludeHttpPages) {
    return false;
  }
  return isHttpPageUrl(rawUrl);
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
    isExcludedHttpPage(rawUrl) ||
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
