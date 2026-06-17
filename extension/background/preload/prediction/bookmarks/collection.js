let cachedBookmarkEntries = null;
let cachedBookmarkEntriesExpiresAt = 0;

async function collectChromeBookmarkEntries(sourceUrl) {
  const now = Date.now();

  if (cachedBookmarkEntries && cachedBookmarkEntriesExpiresAt > now) {
    return cachedBookmarkEntries;
  }

  try {
    const tree = await chrome.bookmarks.getTree();
    const entriesByUrl = new Map();
    let bookmarkIndex = 0;

    for (const node of Array.isArray(tree) ? tree : []) {
      collectChromeBookmarkNodeEntries(node, sourceUrl, entriesByUrl, () => {
        bookmarkIndex += 1;
        return bookmarkIndex;
      });
    }

    cachedBookmarkEntries = [...entriesByUrl.values()];
    cachedBookmarkEntriesExpiresAt = now + BOOKMARK_PRELOAD_CACHE_TTL_MS;
    return cachedBookmarkEntries;
  } catch (error) {
    recordGoogleBookmarkPreloadDiagnostic("prediction.google-bookmarks.error", {
      reason: "collect-failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

function collectChromeBookmarkNodeEntries(node, sourceUrl, entriesByUrl, nextIndex) {
  if (!node || typeof node !== "object") {
    return;
  }

  if (typeof node.url === "string" && node.url) {
    const candidateUrl = normalizeNavigableUrl(node.url, sourceUrl);
    const targetPageUrl = normalizePageUrlForIndex(candidateUrl || "");

    if (candidateUrl && targetPageUrl && !isExcludedTrackingPage(candidateUrl)) {
      const existingEntry = entriesByUrl.get(targetPageUrl);
      const nextEntry = {
        url: candidateUrl,
        targetPageUrl,
        title: normalizeBookmarkTitle(node.title, candidateUrl),
        bookmarkIndex: nextIndex(),
      };

      entriesByUrl.set(
        targetPageUrl,
        existingEntry
          ? selectBetterBookmarkPreloadEntry(existingEntry, nextEntry)
          : nextEntry
      );
    }
  }

  for (const child of Array.isArray(node.children) ? node.children : []) {
    collectChromeBookmarkNodeEntries(child, sourceUrl, entriesByUrl, nextIndex);
  }
}

function selectBetterBookmarkPreloadEntry(existingEntry, nextEntry) {
  if (!existingEntry.title && nextEntry.title) {
    return nextEntry;
  }

  if (nextEntry.title.length > existingEntry.title.length) {
    return {
      ...nextEntry,
      bookmarkIndex: Math.min(existingEntry.bookmarkIndex, nextEntry.bookmarkIndex),
    };
  }

  return existingEntry;
}

function normalizeBookmarkTitle(rawTitle, fallbackUrl) {
  const normalizedTitle = String(rawTitle || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);

  if (normalizedTitle) {
    return normalizedTitle;
  }

  return derivePageLabel(fallbackUrl);
}
