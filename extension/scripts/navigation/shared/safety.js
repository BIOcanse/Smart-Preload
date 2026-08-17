(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});
  const { state, normalizeShortText } = namespace;

  function collectAnchorPreloadSafety(anchor) {
    const relTokens = String(anchor?.rel || anchor?.getAttribute?.("rel") || "")
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .slice(0, 12);

    return {
      downloadAttribute: anchor?.hasAttribute?.("download") === true,
      downloadFileName: normalizeShortText(anchor?.getAttribute?.("download") || ""),
      relTokens,
      typeAttr: normalizeShortText(anchor?.getAttribute?.("type") || "").toLowerCase(),
      // pingAttribute 已移除：它被采集并随每条候选链接上送后台，却**从无任何消费方**
      // （preload-safety-rules/candidate.js 只取 downloadAttribute 与 typeAttr）。
      //
      // `<a ping>` 本身仍是一个未决问题：preventDefault 会取消信标发送，所以接管一个
      // ping 链接会静默吞掉站点的点击统计。但不接管它们等于放弃 Google 搜索结果这个
      // 主场景，属产品决定；真要处理时再按需重新采集。
    };
  }

  function shouldUseBrowserDefaultForPreloadSafety(anchor, targetUrl) {
    return inspectAnchorSideEffectPreloadSafety(anchor, targetUrl).skipPreload === true;
  }

  // rel="noreferrer" 是作者的显式指令：跟随这个链接时不要发送 Referer。
  //
  // 而扩展接管导航后只剩两种执行方式，两种都会破坏它：
  //   - `_self` 走 location.assign()，**一定**带上当前页面作为 Referer；
  //   - `_blank` 走 window.open(url, "_blank", "noopener")，特性串里没有 noreferrer。
  //
  // 与其在每条执行路径上补，不如整条不接管：作者既然显式抑制了 referrer，扩展就不该
  // 替他改写这次导航。代价是这类链接拿不到预加载接管——它们很少见。
  function anchorSuppressesReferrer(anchor) {
    return collectAnchorPreloadSafety(anchor).relTokens.includes("noreferrer");
  }

  function inspectAnchorSideEffectPreloadSafety(anchor, targetUrl) {
    const safety = collectAnchorPreloadSafety(anchor);
    const inspectSideEffectCandidateSafety =
      globalThis.ZeroLatencyPreloadSafetyRules?.inspectSideEffectCandidateSafety;

    if (typeof inspectSideEffectCandidateSafety !== "function") {
      return {
        skipPreload: true,
        sideEffectBlocked: true,
        reason: "preload-safety-rules-unavailable",
        reasons: ["preload-safety-rules-unavailable"],
        sideEffectReasons: ["preload-safety-rules-unavailable"],
        preloadSafety: safety,
      };
    }

    return combineAnchorPreloadSafetyDecisions({
      sideEffectDecision: inspectSideEffectCandidateSafety(
        {
          url: targetUrl,
          preloadSafety: safety,
        },
        targetUrl,
        location.href
      ),
      sensitiveSiteDecision: inspectSensitiveAnchorPreloadSafety(anchor, targetUrl),
      preloadSafety: safety,
    });
  }

  // 已不再需要 anchor 参数（v2 只看 URL），但保留签名以免打断三个调用点；
  // 参数名加下划线表明它是刻意不用的。
  function inspectSensitiveAnchorPreloadSafety(_anchor, targetUrl) {
    if (state.skipSensitivePages === false) {
      return {
        blocked: false,
        reason: "",
        reasons: [],
        categories: [],
        evidence: null,
      };
    }

    // 只传 URL。敏感站点规则 v2 已删掉全部文本提示判据（误判率过高，见
    // shared/sensitive-site-rules/constants.js），所以这里**不再需要**读
    // anchor.innerText 和 parentElement.innerText —— 那两次读取会强制整页样式+布局，
    // 是内容脚本 hover / click / mousedown 路径上最贵的一笔开销，现已从根上消除。
    return (
      globalThis.ZeroLatencySensitiveSiteRules?.inspectUrl?.(targetUrl, {
        baseUrl: location.href,
      }) ?? {
        blocked: false,
        reason: "",
        reasons: [],
        categories: [],
        evidence: null,
      }
    );
  }

  function shouldSkipSensitivePagePreload(rawUrl = location.href) {
    if (state.skipSensitivePages === false) {
      return false;
    }

    return (
      globalThis.ZeroLatencySensitiveSiteRules?.inspectUrl?.(rawUrl, {
        baseUrl: location.href,
      })?.blocked === true
    );
  }

  function combineAnchorPreloadSafetyDecisions({
    sideEffectDecision,
    sensitiveSiteDecision,
    preloadSafety,
  }) {
    const sideEffectReasons = Array.isArray(sideEffectDecision?.sideEffectReasons)
      ? sideEffectDecision.sideEffectReasons
      : [];
    const sensitiveSiteReasons = Array.isArray(sensitiveSiteDecision?.reasons)
      ? sensitiveSiteDecision.reasons
      : [];
    const reasons = [...new Set([...(sideEffectDecision?.reasons || []), ...sensitiveSiteReasons])];

    return {
      skipPreload:
        sideEffectDecision?.skipPreload === true ||
        sensitiveSiteDecision?.blocked === true,
      sideEffectBlocked: sideEffectDecision?.sideEffectBlocked === true,
      sensitiveSiteBlocked: sensitiveSiteDecision?.blocked === true,
      reason: reasons[0] || "",
      reasons,
      sideEffectReasons,
      sensitiveSiteReasons,
      sensitiveSiteCategories: sensitiveSiteDecision?.categories || [],
      sensitiveSiteEvidence: sensitiveSiteDecision?.evidence || null,
      preloadSafety,
    };
  }

  Object.assign(namespace, {
    collectAnchorPreloadSafety,
    inspectAnchorSideEffectPreloadSafety,
    inspectSensitiveAnchorPreloadSafety,
    shouldSkipSensitivePagePreload,
    shouldUseBrowserDefaultForPreloadSafety,
    anchorSuppressesReferrer,
  });
})();
