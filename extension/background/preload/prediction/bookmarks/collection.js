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
    const traversal = collectChromeBookmarkTreeEntries(tree, sourceUrl, entriesByUrl);

    if (traversal.truncatedBy) {
      recordGoogleBookmarkPreloadDiagnostic("prediction.google-bookmarks.truncated", {
        reason: traversal.truncatedBy,
        visitedNodes: traversal.visitedNodes,
        maxDepthReached: traversal.maxDepthReached,
        collectedUrls: entriesByUrl.size,
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

// 显式栈的前序深度优先遍历，替代此前的自递归。
//
// 书签树的深度与节点数完全由用户（以及任何持 bookmarks 权限的其他扩展、书签 HTML 导入）
// 决定，是「外部未知规模数据」：递归遍历没有任何深度或节点上限，深层嵌套会在这里栈溢出，
// 而这条路径每 5 秒（BOOKMARK_PRELOAD_CACHE_TTL_MS）就会重新走一遍整棵树。
//
// 遍历顺序必须与递归版逐字一致 —— bookmarkIndex 编码的是书签次序，
// selectBetterBookmarkPreloadEntry 会拿它做 Math.min 比较。前序 + 子节点从左到右，
// 因此子节点入栈时要反向压入。
function collectChromeBookmarkTreeEntries(tree, sourceUrl, entriesByUrl) {
  const rootNodes = Array.isArray(tree) ? tree : [];
  const stack = [];
  const visitedNodes = new Set();
  let bookmarkIndex = 0;
  let visitedCount = 0;
  let maxDepthReached = 0;
  let truncatedBy = "";

  for (let index = rootNodes.length - 1; index >= 0; index -= 1) {
    stack.push({ node: rootNodes[index], depth: 0 });
  }

  while (stack.length > 0) {
    const { node, depth } = stack.pop();

    if (!node || typeof node !== "object") {
      continue;
    }

    // 去重集合：chrome.bookmarks 返回的是树，但该结构由外部提供，不假设它无环。
    if (visitedNodes.has(node)) {
      continue;
    }

    visitedNodes.add(node);
    visitedCount += 1;
    maxDepthReached = Math.max(maxDepthReached, depth);

    if (visitedCount > BOOKMARK_PRELOAD_MAX_TREE_NODES) {
      truncatedBy = "node-budget";
      break;
    }

    if (typeof node.url === "string" && node.url) {
      const candidateUrl = normalizeNavigableUrl(node.url, sourceUrl);
      const targetPageUrl = normalizePageUrlForIndex(candidateUrl || "");

      if (candidateUrl && targetPageUrl && !isExcludedTrackingPage(candidateUrl)) {
        bookmarkIndex += 1;
        const existingEntry = entriesByUrl.get(targetPageUrl);
        const nextEntry = {
          url: candidateUrl,
          targetPageUrl,
          title: normalizeBookmarkTitle(node.title, candidateUrl),
          bookmarkIndex,
        };

        entriesByUrl.set(
          targetPageUrl,
          existingEntry
            ? selectBetterBookmarkPreloadEntry(existingEntry, nextEntry)
            : nextEntry
        );
      }
    }

    const children = Array.isArray(node.children) ? node.children : [];

    if (children.length === 0) {
      continue;
    }

    if (depth + 1 > BOOKMARK_PRELOAD_MAX_TREE_DEPTH) {
      truncatedBy = truncatedBy || "depth-limit";
      continue;
    }

    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], depth: depth + 1 });
    }
  }

  return {
    visitedNodes: visitedCount,
    maxDepthReached,
    truncatedBy,
  };
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
