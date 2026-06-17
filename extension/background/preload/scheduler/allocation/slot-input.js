(function () {
  function normalizeTabAllocationInputs(tabs) {
    return (Array.isArray(tabs) ? tabs : [])
      .map((tab, index) => {
        const tabId = Number(tab?.tabId);
        const score = Number(tab?.score);
        const cap = Number(tab?.cap);

        if (!Number.isFinite(score) || score <= 0 || !Number.isFinite(cap) || cap <= 0) {
          return null;
        }

        const normalizedTabId = Number.isInteger(tabId) && tabId > 0 ? tabId : index + 1;

        return {
          key: String(normalizedTabId),
          tabId: normalizedTabId,
          score,
          cap: Math.trunc(cap),
          active: tab?.active === true,
          lastActiveAt: normalizeTimestampForPriority(tab?.lastActiveAt),
          order: Number.isFinite(Number(tab?.order)) ? Number(tab.order) : index,
        };
      })
      .filter(Boolean);
  }

  function normalizeTimestampForPriority(value) {
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : 0;
  }

  function compareTabSlotPriority(left, right) {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if (right.active !== left.active) {
      return right.active ? 1 : -1;
    }

    if (right.lastActiveAt !== left.lastActiveAt) {
      return right.lastActiveAt - left.lastActiveAt;
    }

    if (left.order !== right.order) {
      return left.order - right.order;
    }

    return left.tabId - right.tabId;
  }

  function buildTabSlotAllocation(tab, rawSlots, slots) {
    return {
      tabId: tab.tabId,
      score: tab.score,
      cap: tab.cap,
      rawSlots,
      slots,
    };
  }

  globalThis.ZeroLatencyPreloadSchedulerSlotInput = {
    normalizeTabAllocationInputs,
    compareTabSlotPriority,
    buildTabSlotAllocation,
  };
})();
