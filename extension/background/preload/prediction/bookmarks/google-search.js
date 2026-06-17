function isGoogleSearchPageForBookmarkPreload(rawUrl) {
  try {
    const parsedUrl = new URL(rawUrl);

    if (!isGoogleSearchPageHost(parsedUrl.hostname)) {
      return false;
    }

    if (parsedUrl.pathname === "/search") {
      return true;
    }

    return parsedUrl.pathname === "/" || parsedUrl.pathname === "/webhp";
  } catch (_error) {
    return false;
  }
}

function isGoogleSearchPageHost(hostname) {
  const normalizedHostname = String(hostname || "").toLowerCase();

  return (
    normalizedHostname === "google.com" ||
    normalizedHostname === "www.google.com" ||
    normalizedHostname.startsWith("google.") ||
    normalizedHostname.startsWith("www.google.")
  );
}
