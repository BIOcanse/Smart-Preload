function resolveNativePageSlotLimit(settings, overrideValue = null, options = {}) {
  const overridePageSlotLimit = Number(overrideValue);
  const configuredPageSlotLimit = resolveConfiguredNativePageSlotLimit(settings);

  if (Number.isFinite(overridePageSlotLimit)) {
    const normalizedOverride = Math.max(0, Math.trunc(overridePageSlotLimit));

    if (options?.ignoreConfiguredSourceSlotCaps === true) {
      return normalizedOverride;
    }

    return Math.min(normalizedOverride, configuredPageSlotLimit);
  }

  return configuredPageSlotLimit;
}

function resolveConfiguredNativePageSlotLimit(settings) {
  const configuredPageSlotLimit = Number(
    settings?.preloading?.effectiveNativeMaxPreloadsPerSource
  );

  return Number.isFinite(configuredPageSlotLimit)
    ? Math.max(1, Math.trunc(configuredPageSlotLimit))
    : Math.max(
        1,
        settingsApi.DEFAULT_SETTINGS.preloading.nativeMaxPreloadsPerSource ??
          settingsApi.DEFAULT_SETTINGS.preloading.maxTabsPerSource
      );
}

function resolveTabPageSlotLimit(settings, overrideValue = null, options = {}) {
  const overridePageSlotLimit = Number(overrideValue);
  const configuredPageSlotLimit = resolveConfiguredTabPageSlotLimit(settings);

  if (Number.isFinite(overridePageSlotLimit)) {
    const normalizedOverride = Math.max(0, Math.trunc(overridePageSlotLimit));

    if (options?.ignoreConfiguredSourceSlotCaps === true) {
      return normalizedOverride;
    }

    return Math.min(normalizedOverride, configuredPageSlotLimit);
  }

  return configuredPageSlotLimit;
}

function resolveConfiguredTabPageSlotLimit(settings) {
  const configuredPageSlotLimit = Number(settings?.preloading?.effectiveTabMaxPreloadsPerSource);

  return Number.isFinite(configuredPageSlotLimit)
    ? Math.max(1, Math.trunc(configuredPageSlotLimit))
    : Math.max(1, settingsApi.DEFAULT_SETTINGS.preloading.maxTabsPerSource);
}

function resolveNativeSiteSelectionLimit(settings, pageSlotLimit) {
  const configuredSiteSelectionLimit = Number(settings?.preloading?.effectiveSiteSelectionLimit);

  if (Number.isFinite(configuredSiteSelectionLimit)) {
    return Math.max(1, Math.trunc(configuredSiteSelectionLimit));
  }

  return pageSlotLimit;
}

function resolveTabSiteSelectionLimit(settings, pageSlotLimit) {
  const configuredSiteSelectionLimit = Number(
    settings?.preloading?.effectiveTabSiteSelectionLimit
  );

  if (Number.isFinite(configuredSiteSelectionLimit)) {
    return Math.max(1, Math.trunc(configuredSiteSelectionLimit));
  }

  return resolveNativeSiteSelectionLimit(settings, pageSlotLimit);
}

function allocateSelectedSitePageSlots(a, scores, caps, transform = (value) => Math.sqrt(value)) {
  if (!Number.isInteger(a) || a < 0) {
    throw new Error("a must be a non-negative integer");
  }

  if (
    !Array.isArray(scores) ||
    !Array.isArray(caps) ||
    scores.length === 0 ||
    scores.length !== caps.length
  ) {
    throw new Error("scores and caps must be arrays of the same non-zero length");
  }

  const n = scores.length;

  for (let index = 0; index < n; index += 1) {
    if (
      typeof scores[index] !== "number" ||
      !Number.isFinite(scores[index]) ||
      scores[index] <= 0
    ) {
      throw new Error(`scores[${index}] must be a positive finite number`);
    }

    if (!Number.isInteger(caps[index]) || caps[index] < 1) {
      throw new Error(`caps[${index}] must be an integer >= 1`);
    }
  }

  if (a < n) {
    throw new Error("No feasible solution: a is smaller than number of selected items");
  }

  const totalCap = caps.reduce((sum, value) => sum + value, 0);

  if (a > totalCap) {
    throw new Error("No feasible solution: a is greater than total capacity");
  }

  const baseline = new Array(n).fill(1);
  const remainingSlots = a - n;

  if (remainingSlots === 0) {
    return baseline;
  }

  const extraCaps = caps.map((cap) => cap - 1);
  const weights = scores.map(transform);

  for (let index = 0; index < n; index += 1) {
    if (!(weights[index] >= 0) || !Number.isFinite(weights[index])) {
      throw new Error(
        `transform(scores[${index}]) must produce a finite non-negative number`
      );
    }
  }

  const totalWeight = weights.reduce((sum, value) => sum + value, 0);

  if (totalWeight <= 0) {
    throw new Error("Total transformed weight must be positive");
  }

  const targets = weights.map((weight) => (remainingSlots * weight) / totalWeight);
  const inf = Number.POSITIVE_INFINITY;
  let previous = new Array(remainingSlots + 1).fill(inf);
  previous[0] = 0;
  const choice = Array.from({ length: n }, () => new Array(remainingSlots + 1).fill(-1));
  const parentSum = Array.from({ length: n }, () => new Array(remainingSlots + 1).fill(-1));

  for (let index = 0; index < n; index += 1) {
    const current = new Array(remainingSlots + 1).fill(inf);
    const maxExtraCap = Math.min(extraCaps[index], remainingSlots);

    for (let partialSum = 0; partialSum <= remainingSlots; partialSum += 1) {
      if (!Number.isFinite(previous[partialSum])) {
        continue;
      }

      for (
        let extraCount = 0;
        extraCount <= maxExtraCap && partialSum + extraCount <= remainingSlots;
        extraCount += 1
      ) {
        const nextSum = partialSum + extraCount;
        const cost =
          previous[partialSum] + (extraCount - targets[index]) * (extraCount - targets[index]);

        if (cost < current[nextSum]) {
          current[nextSum] = cost;
          choice[index][nextSum] = extraCount;
          parentSum[index][nextSum] = partialSum;
        }
      }
    }

    previous = current;
  }

  if (!Number.isFinite(previous[remainingSlots])) {
    throw new Error("No feasible solution exists under the constraints");
  }

  const extra = new Array(n).fill(0);
  let partialSum = remainingSlots;

  for (let index = n - 1; index >= 0; index -= 1) {
    extra[index] = choice[index][partialSum];
    partialSum = parentSum[index][partialSum];
  }

  return baseline.map((value, index) => value + extra[index]);
}
