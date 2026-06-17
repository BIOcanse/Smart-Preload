(function () {
  function createSchedulerFormController({ elements, settingsApi }) {
    const schedulerElements = [
      elements.schedulerTabTotalMin,
      elements.schedulerTabTotalMax,
      elements.schedulerTabHalfLifeTabs,
      elements.schedulerNativeTotalMin,
      elements.schedulerNativeTotalMax,
      elements.schedulerNativeHalfLifeTabs,
      elements.schedulerAttentionPoolHours,
      elements.schedulerAttentionSegmentSeconds,
      elements.schedulerAttentionMaxGapSeconds,
      elements.schedulerAttentionInputWindowSeconds,
      elements.schedulerAttentionMediaWeight,
      elements.schedulerAttentionAudioWeight,
    ].filter(Boolean);

    function isSchedulerFormElement(element) {
      return schedulerElements.includes(element);
    }

    function readSchedulerSettingsFromForm() {
      return {
        nativeTotalMin: Number(elements.schedulerNativeTotalMin.value),
        nativeTotalMax: Number(elements.schedulerNativeTotalMax.value),
        nativeHalfLifeTabs: Number(elements.schedulerNativeHalfLifeTabs.value),
        tabTotalMin: Number(elements.schedulerTabTotalMin.value),
        tabTotalMax: Number(elements.schedulerTabTotalMax.value),
        tabHalfLifeTabs: Number(elements.schedulerTabHalfLifeTabs.value),
        attentionPoolHours: Number(elements.schedulerAttentionPoolHours.value),
        attentionSegmentSeconds: Number(elements.schedulerAttentionSegmentSeconds.value),
        attentionMaxObservableGapSeconds: Number(
          elements.schedulerAttentionMaxGapSeconds.value
        ),
        attentionInputWindowSeconds: Number(
          elements.schedulerAttentionInputWindowSeconds.value
        ),
        attentionMediaPlaybackWeight: Number(elements.schedulerAttentionMediaWeight.value),
        attentionAudioPlaybackWeight: Number(elements.schedulerAttentionAudioWeight.value),
      };
    }

    function syncSchedulerFieldsFromSettings(settings) {
      const schedulerSettings =
        settings.preloading?.scheduler ?? settingsApi.DEFAULT_SETTINGS.preloading.scheduler;

      elements.schedulerNativeTotalMin.value = String(schedulerSettings.nativeTotalMin);
      elements.schedulerNativeTotalMax.value = String(schedulerSettings.nativeTotalMax);
      elements.schedulerNativeHalfLifeTabs.value = String(schedulerSettings.nativeHalfLifeTabs);
      elements.schedulerTabTotalMin.value = String(schedulerSettings.tabTotalMin);
      elements.schedulerTabTotalMax.value = String(schedulerSettings.tabTotalMax);
      elements.schedulerTabHalfLifeTabs.value = String(schedulerSettings.tabHalfLifeTabs);
      elements.schedulerAttentionPoolHours.value = String(
        schedulerSettings.attentionPoolHours
      );
      elements.schedulerAttentionSegmentSeconds.value = String(
        schedulerSettings.attentionSegmentSeconds
      );
      elements.schedulerAttentionMaxGapSeconds.value = String(
        schedulerSettings.attentionMaxObservableGapSeconds
      );
      elements.schedulerAttentionInputWindowSeconds.value = String(
        schedulerSettings.attentionInputWindowSeconds
      );
      elements.schedulerAttentionMediaWeight.value = String(
        schedulerSettings.attentionMediaPlaybackWeight
      );
      elements.schedulerAttentionAudioWeight.value = String(
        schedulerSettings.attentionAudioPlaybackWeight
      );
    }

    return {
      isSchedulerFormElement,
      readSchedulerSettingsFromForm,
      syncSchedulerFieldsFromSettings,
    };
  }

  globalThis.ZeroLatencySettingsSchedulerForm = {
    create: createSchedulerFormController,
  };
})();
