(function () {
  function normalizeHiddenTabSyncChannel(channel) {
    return channel === "bookmark" ? "bookmark" : "scheduled";
  }

  function shouldManageHiddenTabTargetForChannel(target, channel) {
    const isBookmarkTarget = Boolean(target?.bookmarkPreload);
    return channel === "bookmark" ? isBookmarkTarget : !isBookmarkTarget;
  }

  function shouldManageExistingHiddenTabEntryForChannel(entry, channel) {
    if (entry?.interactionPreload) {
      return false;
    }

    const isBookmarkEntry = Boolean(entry?.bookmarkPreload);
    return channel === "bookmark" ? isBookmarkEntry : !isBookmarkEntry;
  }

  function canUpdateExistingHiddenTabEntryForChannel(entry, target, channel) {
    if (entry?.interactionPreload) {
      return false;
    }

    const isBookmarkTarget = Boolean(target?.bookmarkPreload);

    if (channel === "bookmark") {
      return isBookmarkTarget;
    }

    return !isBookmarkTarget && !entry?.bookmarkPreload;
  }

  globalThis.ZeroLatencyHiddenTabDiffChannel = {
    normalizeHiddenTabSyncChannel,
    shouldManageHiddenTabTargetForChannel,
    shouldManageExistingHiddenTabEntryForChannel,
    canUpdateExistingHiddenTabEntryForChannel,
  };
})();
