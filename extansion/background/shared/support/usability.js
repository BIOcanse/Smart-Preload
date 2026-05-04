let _systemHidingUsable = false;

function isSystemLevelWindowHidingUsable() {
  return _systemHidingUsable;
}

function setSystemLevelWindowHidingUsable(value) {
  _systemHidingUsable = value === true;
}

async function probeNativeAppAvailability(options = {}) {
  if (!supportsSystemLevelWindowHiding()) {
    setSystemLevelWindowHidingUsable(false);
    return false;
  }

  const forceRefresh = options.forceRefresh !== false;
  const available = await nativeAppHealthCheck({ forceRefresh });
  setSystemLevelWindowHidingUsable(available);
  return available;
}
