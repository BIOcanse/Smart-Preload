let _systemHidingUsable = false;

function isSystemLevelWindowHidingUsable() {
  return _systemHidingUsable;
}

function setSystemLevelWindowHidingUsable(value) {
  _systemHidingUsable = value === true;
}

async function probeNativeAppAvailability() {
  if (!supportsSystemLevelWindowHiding()) {
    setSystemLevelWindowHidingUsable(false);
    return false;
  }

  const available = await nativeAppHealthCheck({ forceRefresh: true });
  setSystemLevelWindowHidingUsable(available);
  return available;
}
