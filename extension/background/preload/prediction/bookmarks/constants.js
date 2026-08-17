const BOOKMARK_PRELOAD_BUCKET_STARTUP_GOOGLE_SEARCH = "startupGoogleSearch";
const BOOKMARK_PRELOAD_BUCKET_NEW_GOOGLE_SEARCH_TAB = "newGoogleSearchTab";
const BOOKMARK_PRELOAD_CACHE_TTL_MS = 5_000;
// 书签树来自 chrome.bookmarks.getTree()，深度和节点数都由用户（以及任何有 bookmarks
// 权限的其他扩展、以及书签 HTML 导入）决定，属于「外部未知规模数据」。遍历必须带硬上限。
// 触顶时会记 prediction.google-bookmarks.truncated 诊断事件，不静默截断。
const BOOKMARK_PRELOAD_MAX_TREE_DEPTH = 64;
const BOOKMARK_PRELOAD_MAX_TREE_NODES = 50_000;
