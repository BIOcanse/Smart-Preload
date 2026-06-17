(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});

  function navigateWithoutPreload(targetUrl, navigationTarget) {
    if (navigationTarget === "_blank") {
      window.open(targetUrl, "_blank", "noopener");
      return;
    }

    location.assign(targetUrl);
  }

  function navigateWithReservedWindow(reservedWindow, targetUrl, navigationTarget) {
    if (navigationTarget !== "_blank") {
      navigateWithoutPreload(targetUrl, navigationTarget);
      return;
    }

    if (reservedWindow && !reservedWindow.closed) {
      reservedWindow.location.replace(targetUrl);
      return;
    }

    navigateWithoutPreload(targetUrl, navigationTarget);
  }

  function openReservedBlankWindow() {
    const reservedWindow = window.open("about:blank", "_blank");

    if (!reservedWindow) {
      return null;
    }

    try {
      reservedWindow.opener = null;
    } catch (_error) {
      // Ignore browsers that block reassigning opener.
    }

    return reservedWindow;
  }

  function executeNavigationResolution(resolution, { targetUrl, targetHint, reservedWindow }) {
    if (resolution?.handled === true) {
      reservedWindow?.close();
      return;
    }

    switch (resolution?.action) {
      case "navigate-current-tab":
        navigateWithoutPreload(targetUrl, "_self");
        return;
      case "navigate-reserved-tab":
        navigateWithReservedWindow(reservedWindow, targetUrl, "_blank");
        return;
      case "allow-browser-default":
        reservedWindow?.close();
        navigateWithoutPreload(targetUrl, targetHint);
        return;
      default:
        reservedWindow?.close();
        navigateWithoutPreload(targetUrl, targetHint);
        return;
    }
  }

  Object.assign(namespace, {
    executeNavigationResolution,
    openReservedBlankWindow,
  });
})();
