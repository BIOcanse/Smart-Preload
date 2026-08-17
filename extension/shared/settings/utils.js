(function () {
  // DEFAULT_SETTINGS 目前最深 4 层；留足余量。触顶时该键退化为整体覆盖（cloneSettings），
  // 与 base 侧不是对象时的行为一致，不会丢键。
  const MAX_SETTINGS_MERGE_DEPTH = 32;

  function cloneSettings(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  // 显式栈的深合并，替代此前的自递归。
  //
  // 递归深度其实由 base（始终是 DEFAULT_SETTINGS 的某个子树）决定而非由 override 决定
  // ——只有两侧同为对象时才下钻，所以再深的 override 也会在 schema 用完那层停下。
  // 也就是说这里从来不存在栈溢出风险；改造纯粹是为了统一遵守「禁递归」这条工程约定，
  // 顺带把深度上限写成显式的，而不是依赖「DEFAULT_SETTINGS 恰好很浅」这个隐含前提。
  function mergeSettings(base, override) {
    if (!isPlainObject(base)) {
      return cloneSettings(override);
    }

    const root = cloneSettings(base);

    if (!isPlainObject(override)) {
      return root;
    }

    const stack = [{ target: root, source: override, depth: 0 }];

    while (stack.length > 0) {
      const { target, source, depth } = stack.pop();

      for (const [key, value] of Object.entries(source)) {
        if (
          isPlainObject(value) &&
          isPlainObject(target[key]) &&
          depth < MAX_SETTINGS_MERGE_DEPTH
        ) {
          stack.push({ target: target[key], source: value, depth: depth + 1 });
          continue;
        }

        target[key] = cloneSettings(value);
      }
    }

    return root;
  }

  function clamp(value, min, max, fallback) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return fallback;
    }

    return Math.min(max, Math.max(min, Math.round(numericValue)));
  }

  function wildcardMatch(value, pattern) {
    const regex = new RegExp(`^${escapeRegex(pattern).replace(/\\\*/g, ".*")}$`);
    return regex.test(String(value || "").toLowerCase());
  }

  function escapeRegex(value) {
    return String(value).replace(/[|\\{}()[\]^$+?.*]/g, "\\$&");
  }

  function parseUrlForRuleMatch(value) {
    try {
      const parsedUrl = new URL(String(value || ""));
      return {
        href: parsedUrl.href.toLowerCase(),
        host: parsedUrl.host.toLowerCase(),
        hostname: parsedUrl.hostname.toLowerCase(),
        pathname: parsedUrl.pathname.toLowerCase(),
        search: parsedUrl.search.toLowerCase(),
        hash: parsedUrl.hash.toLowerCase(),
      };
    } catch (_error) {
      return null;
    }
  }

  globalThis.ZeroLatencySettingsUtils = {
    cloneSettings,
    isPlainObject,
    mergeSettings,
    clamp,
    wildcardMatch,
    escapeRegex,
    parseUrlForRuleMatch,
  };
})();
