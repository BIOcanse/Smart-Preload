(function () {
  function normalizePreloadWindowState(rawValue) {
    const nextValue = isPlainObject(rawValue) ? rawValue : {};

    return {
      windowId: normalizePositiveInteger(nextValue.windowId),
      hwnd: normalizePositiveFiniteNumber(nextValue.hwnd),
      hiddenBySystem: nextValue.hiddenBySystem === true,
      systemHideFailureCount: clampNonNegativeInt(nextValue.systemHideFailureCount, 0),
      systemHideDisabledUntil: normalizePositiveFiniteNumber(
        nextValue.systemHideDisabledUntil
      ),
      lastSystemHideError:
        typeof nextValue.lastSystemHideError === "string"
          ? nextValue.lastSystemHideError
          : null,
      lastSystemHideFailedAt:
        typeof nextValue.lastSystemHideFailedAt === "string"
          ? nextValue.lastSystemHideFailedAt
          : null,
      updatedAt: typeof nextValue.updatedAt === "string" ? nextValue.updatedAt : null,
    };
  }

  globalThis.normalizePreloadWindowState = normalizePreloadWindowState;
})();
