(function () {
  // 「设备自动调优」整块已于 2026-08-02 删除。
  //
  // 原本这里有 getNavigatorSnapshot() / detectDeviceProfile()，算出一个带 preloadCap
  // 的 deviceProfile 并挂在 detectedDeviceProfile 上——**全仓库零消费方**，配套的
  // automaticDeviceTuning 设置项同样既无行为消费方也无 UI 控件。也就是说这个特性被
  // 设计过但一根线都没接上，却持续占着存储、i18n key 和每次 resolveEffectiveSettings
  // 的计算。要补完的话那是一个新功能，不该以半成品形式挂着。
  //
  // 顺带记一条实现事实，将来若重做：`navigator.deviceMemory` 按规范取 2 的幂并**上限
  // 夹到 8**，所以「按内存判定 high-end」（原来的 `deviceMemory >= 16`）用这个 API
  // 根本实现不了，只能靠 hardwareConcurrency。
  function createEffectiveSettingsApi({
    normalizeStoredSettings,
    isAiPredictionConfigured,
  }) {
    function resolveEffectiveSettings(userSettings) {
      const normalized = normalizeStoredSettings(userSettings);
      const effectiveTransitionWindowKey = normalized.preloading.transitionWindowScope.enabled
        ? normalized.preloading.transitionWindowScope.windowKey
        : "total";

      return {
        ...normalized,
        // 这里曾经是 `siteSelectionLimit ?? nativeMaxPreloadsPerSource ?? maxTabsPerSource`
        // 外面再套 Math.max(1, …)。那整条回退链和外面的下限**都是死代码**：
        // normalizeStoredSettings 已经用 derive*FromRuleCard + clamp(value, 1, 20, default)
        // 把这四个键全部夹成 [1,20] 的整数（normalize.js、rules.js:68-140），
        // 到这里既不可能是 nullish 也不可能小于 1。留着它会让人误以为存在一条运行时回退链。
        //
        // **真正的限制在 normalize 那一层**：下限是 1，用户无法填 0 来表达
        // 「此来源不预加载」。那是产品取舍，未在本次改动中变更。
        preloading: {
          ...normalized.preloading,
          effectiveNativeMaxPreloadsPerSource: normalized.preloading.nativeMaxPreloadsPerSource,
          effectiveTabMaxPreloadsPerSource: normalized.preloading.maxTabsPerSource,
          effectiveMaxTabsPerSource: normalized.preloading.maxTabsPerSource,
          effectiveSiteSelectionLimit: normalized.preloading.siteSelectionLimit,
          effectiveTabSiteSelectionLimit: normalized.preloading.tabSiteSelectionLimit,
          effectiveTransitionWindowKey,
          effectiveRealPreloadEnabled: normalized.preloading.realPreloadEnabled === true,
          effectiveAllNativePreloadMode: normalized.preloading.realPreloadEnabled !== true,
          effectivePreloadScheduler: normalized.preloading.scheduler,
          effectiveAiPredictionConfigured: isAiPredictionConfigured(
            normalized.preloading.aiPrediction
          ),
        },
      };
    }

    return {
      resolveEffectiveSettings,
    };
  }

  globalThis.ZeroLatencySettingsEffective = {
    create: createEffectiveSettingsApi,
  };
})();
