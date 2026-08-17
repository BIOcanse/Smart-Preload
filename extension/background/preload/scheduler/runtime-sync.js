// stableStringifyPreloadSelectionValue 的硬上限。当前输入是调度器自建的固定形状对象，
// 深度个位数；这两个值留了充足余量。触顶或遇到环会记
// preload-selection.fingerprint.truncated，不静默产出错误指纹。
const MAX_PRELOAD_SELECTION_STRINGIFY_DEPTH = 32;
const MAX_PRELOAD_SELECTION_STRINGIFY_CONTAINERS = 10_000;

async function synchronizeScheduledPreloadSelection(preloadState, scheduledSelection) {
  recordSchedulerRuntimeSyncEvent("scheduler.sync.source", {
    sourceTabId: scheduledSelection.sourceTabId,
    sourceWindowId: scheduledSelection.sourceWindowId,
    sourcePageUrl: scheduledSelection.sourcePageUrl,
    nativeSlots: scheduledSelection.nativeSlots,
    tabSlots: scheduledSelection.tabSlots,
    selectedCounts: countSchedulerSelectionTargets(scheduledSelection.selection),
  });
  return globalThis.ZeroLatencyPreloadDiff.applySourceTabSelection({
    preloadState,
    sourceWindowId: scheduledSelection.sourceWindowId,
    sourceTabId: scheduledSelection.sourceTabId,
    selection: scheduledSelection.selection,
  });
}

async function synchronizeChangedScheduledPreloadSelections(
  preloadState,
  scheduledSelections
) {
  let nextPreloadState = preloadState;
  const changedSelections = [];

  for (const scheduledSelection of Array.isArray(scheduledSelections)
    ? scheduledSelections
    : []) {
    if (!doesScheduledPreloadSelectionDiffer(nextPreloadState, scheduledSelection)) {
      recordSchedulerRuntimeSyncEvent("scheduler.sync.source-unchanged", {
        sourceTabId: scheduledSelection.sourceTabId,
        sourceWindowId: scheduledSelection.sourceWindowId,
        sourcePageUrl: scheduledSelection.sourcePageUrl,
      });
      continue;
    }

    nextPreloadState = await synchronizeScheduledPreloadSelection(
      nextPreloadState,
      scheduledSelection
    );
    changedSelections.push(scheduledSelection);
  }

  return {
    preloadState: nextPreloadState,
    changedSelections,
  };
}

function doesScheduledPreloadSelectionDiffer(preloadState, scheduledSelection) {
  const expectedFingerprint = buildScheduledPreloadSelectionFingerprint(
    scheduledSelection?.selection
  );
  const appliedFingerprint = buildAppliedPreloadSelectionFingerprint(
    preloadState,
    scheduledSelection
  );
  return appliedFingerprint === null || expectedFingerprint !== appliedFingerprint;
}

function buildScheduledPreloadSelectionFingerprint(selection) {
  return buildPreloadSelectionFingerprint(
    (Array.isArray(selection?.selectedTargets) ? selection.selectedTargets : []).map(
      (target) => ({
        strategy: target?.strategy,
        url: target?.url,
        nodeId: target?.nodeId,
        score: target?.score,
        targetHint: target?.targetHint,
        bookmarkPreload: target?.bookmarkPreload,
        scoreBreakdown: target?.scoreBreakdown,
        transitionMetrics: target?.transitionMetrics,
        aiKeywordMatch: target?.aiKeywordMatch,
        realPreloadSafety: target?.realPreloadSafety,
        siteSelection: target?.siteSelection,
      })
    )
  );
}

function buildAppliedPreloadSelectionFingerprint(preloadState, scheduledSelection) {
  if (
    typeof globalThis.findSourceTabRuntime !== "function" ||
    typeof globalThis.getSourceTabPreloadChannelStore !== "function"
  ) {
    return null;
  }

  const sourceRuntimeEntry = globalThis.findSourceTabRuntime(
    preloadState,
    scheduledSelection?.sourceTabId
  );

  if (
    sourceRuntimeEntry &&
    Number(sourceRuntimeEntry.normalWindowId) !== Number(scheduledSelection?.sourceWindowId)
  ) {
    return null;
  }

  const sourceRuntime = sourceRuntimeEntry?.sourceTabRuntime;

  if (!sourceRuntime) {
    return "[]";
  }

  const appliedTargets = [];

  for (const [channel, strategy] of [
    ["hiddenTab", "hidden-tab"],
    ["prerender", "prerender"],
    ["prefetch", "prefetch"],
  ]) {
    for (const [url, entry] of Object.entries(
      globalThis.getSourceTabPreloadChannelStore(sourceRuntime, channel)
    )) {
      if (entry?.interactionPreload) {
        continue;
      }

      appliedTargets.push({
        strategy,
        url: entry?.requestedUrl || url,
        nodeId: entry?.nodeId,
        score: entry?.score,
        targetHint: entry?.targetHint,
        bookmarkPreload: entry?.bookmarkPreload,
        scoreBreakdown: entry?.scoreBreakdown,
        transitionMetrics: entry?.transitionMetrics,
        aiKeywordMatch: entry?.aiKeywordMatch,
        realPreloadSafety: entry?.realPreloadSafety,
        siteSelection: entry?.siteSelection,
      });
    }
  }

  return buildPreloadSelectionFingerprint(appliedTargets);
}

function buildPreloadSelectionFingerprint(targets) {
  const normalizedTargets = (Array.isArray(targets) ? targets : [])
    .map((target) => {
      const strategy = typeof target?.strategy === "string" ? target.strategy : "";

      return {
        strategy,
        url: typeof target?.url === "string" ? target.url : "",
        nodeId: typeof target?.nodeId === "string" ? target.nodeId : "",
        score: Number.isFinite(Number(target?.score)) ? Number(target.score) : 0,
        targetHint:
          strategy === "prerender" && typeof target?.targetHint === "string"
            ? target.targetHint
            : "",
        metadata: stableStringifyPreloadSelectionValue({
          bookmarkPreload: target?.bookmarkPreload ?? null,
          scoreBreakdown: target?.scoreBreakdown ?? null,
          transitionMetrics: target?.transitionMetrics ?? null,
          aiKeywordMatch: target?.aiKeywordMatch ?? null,
          realPreloadSafety: target?.realPreloadSafety ?? null,
          siteSelection: target?.siteSelection ?? null,
        }),
      };
    })
    .filter((target) => target.strategy && target.url);
  const uniqueTargets = new Map();

  for (const target of normalizedTargets) {
    uniqueTargets.set(`${target.strategy}\n${target.url}`, target);
  }

  const sortedTargets = [...uniqueTargets.values()]
    .sort((left, right) =>
      `${left.strategy}\n${left.url}`.localeCompare(`${right.strategy}\n${right.url}`)
    );

  return JSON.stringify(sortedTargets);
}

// 显式栈的稳定序列化，替代此前的手写自递归。
//
// 手写递归版没有任何深度上限，而且——与 JSON.stringify 不同——遇到环不会抛 TypeError
// 而是直接栈溢出。当前输入是调度器自建的固定形状对象（见 buildPreloadSelectionFingerprint），
// 深度小且不可能成环，所以这不是活缺陷；改造是为了遵守「禁递归」这条工程约定。
//
// **逐字保留原输出**：这是 fingerprint，输出变一个字节就会造成一次虚假的「已变更」。
// 因此不改用 JSON.stringify + replacer —— 那条路在两处会给出不同结果：对象里的
// undefined 被原生省略（手写版输出 `"key":null`），带 toJSON 的对象（Date）被原生
// 展开成字符串（手写版按普通对象枚举得到 `{}`）。显式栈按构造就是字节等价。
//
// 栈是 LIFO，所以子项要反序压入才能保持「先左后右」的输出顺序。
function stableStringifyPreloadSelectionValue(rootValue) {
  const parts = [];
  const stack = [{ value: rootValue, depth: 0 }];
  const openContainers = new Set();
  let visitedContainers = 0;

  while (stack.length > 0) {
    const item = stack.pop();

    if (typeof item.emit === "string") {
      openContainers.delete(item.closes);
      parts.push(item.emit);
      continue;
    }

    const { value, depth } = item;
    const isArray = Array.isArray(value);
    const isObject = Boolean(value) && typeof value === "object" && !isArray;

    if (!isArray && !isObject) {
      parts.push(JSON.stringify(value) ?? "null");
      continue;
    }

    visitedContainers += 1;

    // 环与超限：手写版在这两种情况下会栈溢出，这里退化为 null 并留下记录。
    if (
      openContainers.has(value) ||
      depth >= MAX_PRELOAD_SELECTION_STRINGIFY_DEPTH ||
      visitedContainers > MAX_PRELOAD_SELECTION_STRINGIFY_CONTAINERS
    ) {
      parts.push("null");
      globalThis.ZeroLatencyDebugEvents?.record?.("preload-selection.fingerprint.truncated", {
        reason: openContainers.has(value)
          ? "cycle"
          : depth >= MAX_PRELOAD_SELECTION_STRINGIFY_DEPTH
            ? "depth-limit"
            : "container-budget",
        depth,
        visitedContainers,
      });
      continue;
    }

    openContainers.add(value);

    if (isArray) {
      parts.push("[");
      stack.push({ emit: "]", closes: value });

      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], depth: depth + 1 });

        if (index > 0) {
          stack.push({ emit: "," });
        }
      }

      continue;
    }

    const keys = Object.keys(value).sort();
    parts.push("{");
    stack.push({ emit: "}", closes: value });

    for (let index = keys.length - 1; index >= 0; index -= 1) {
      stack.push({ value: value[keys[index]], depth: depth + 1 });
      stack.push({ emit: `${JSON.stringify(keys[index])}:` });

      if (index > 0) {
        stack.push({ emit: "," });
      }
    }
  }

  return parts.join("");
}

async function queryOpenNormalTabs() {
  try {
    const tabs = await chrome.tabs.query({
      windowType: "normal",
    });
    const settings =
      typeof getEffectiveExtensionSettings === "function"
        ? getEffectiveExtensionSettings()
        : null;

    return tabs.filter(
      (tab) =>
        globalThis.ZeroLatencyPreloadIncognitoPolicy?.shouldExcludeIncognitoPreloadSource?.(
          tab,
          settings
        ) !== true &&
        globalThis.ZeroLatencyPreloadProxySkipPolicy?.shouldSkipProxyPreloadSource?.(
          tab,
          settings
        ) !== true
    );
  } catch (_error) {
    return [];
  }
}

async function notifyScheduledSourceTabs(scheduledSelections) {
  for (const scheduledSelection of Array.isArray(scheduledSelections)
    ? scheduledSelections
    : []) {
    try {
      await chrome.tabs.sendMessage(scheduledSelection.sourceTabId, {
        type: "preload:apply-speculation-rules",
        prerenderTargets: scheduledSelection.selection.prerenderTargets,
        prefetchTargets: scheduledSelection.selection.prefetchTargets,
      });
    } catch (_error) {
      // The tab may not currently have a live content script.
    }
  }
}

function countSchedulerSelectionTargets(selection) {
  return {
    selected: Array.isArray(selection?.selectedTargets)
      ? selection.selectedTargets.length
      : 0,
    hiddenTab: Array.isArray(selection?.tabTargets) ? selection.tabTargets.length : 0,
    prerender: Array.isArray(selection?.prerenderTargets)
      ? selection.prerenderTargets.length
      : 0,
    prefetch: Array.isArray(selection?.prefetchTargets)
      ? selection.prefetchTargets.length
      : 0,
  };
}

function recordSchedulerRuntimeSyncEvent(eventName, payload = {}) {
  globalThis.ZeroLatencyDebugEvents?.record?.(eventName, payload);
}
