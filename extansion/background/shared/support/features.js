function supportsHiddenTabPreloadRuntime() {
  return (
    hasChromeNamespaceMethod("tabs", "create") &&
    hasChromeNamespaceMethod("tabs", "update") &&
    hasChromeNamespaceMethod("tabs", "move") &&
    hasChromeNamespaceMethod("tabs", "remove") &&
    hasChromeNamespaceMethod("tabs", "get") &&
    hasChromeNamespaceMethod("windows", "create") &&
    hasChromeNamespaceMethod("windows", "update") &&
    hasChromeNamespaceMethod("windows", "remove") &&
    hasChromeNamespaceMethod("windows", "get") &&
    hasChromeNamespaceMethod("windows", "getAll")
  );
}

function supportsPreloadWindowWatchdog() {
  return (
    supportsHiddenTabPreloadRuntime() &&
    hasChromeNamespaceMethod("alarms", "create") &&
    hasChromeNamespaceMethod("alarms", "clear")
  );
}

function supportsSystemLevelWindowHiding() {
  return (
    supportsHiddenTabPreloadRuntime() &&
    detectPlatformSupport().windows === true
  );
}

function getBackgroundFeatureSupport() {
  const platform = detectPlatformSupport();
  return {
    hiddenTabPreload: supportsHiddenTabPreloadRuntime(),
    preloadWindowWatchdog: supportsPreloadWindowWatchdog(),
    systemLevelWindowHiding: supportsSystemLevelWindowHiding(),
    systemLevelWindowHidingUsable: isSystemLevelWindowHidingUsable(),
    platform,
  };
}
