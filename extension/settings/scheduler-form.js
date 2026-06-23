(function () {
  function createSchedulerFormController({ elements, settingsApi }) {
    const schedulerElements = [
      elements.schedulerTabTotalMin,
      elements.schedulerTabTotalMax,
      elements.schedulerTabHalfLifeTabs,
      elements.schedulerNativeTotalMin,
      elements.schedulerNativeTotalMax,
      elements.schedulerNativeHalfLifeTabs,
      elements.schedulerAttentionPoolEnabled,
      elements.schedulerAttentionPoolMinutes,
      elements.schedulerAttentionSegmentSeconds,
      elements.schedulerAttentionMaxGapSeconds,
      elements.schedulerAttentionInputWindowSeconds,
      elements.schedulerAttentionMediaWeight,
      elements.schedulerAttentionAudioWeight,
      elements.schedulerAttentionLinkSoftSeconds,
      elements.schedulerAttentionLinkSoftWeight,
      elements.schedulerAttentionLinkHardSeconds,
      elements.schedulerAttentionLinkHardWeight,
      elements.schedulerAttentionLinkZeroSeconds,
      elements.schedulerAttentionSiteShareRatio,
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
        attentionPoolEnabled: elements.schedulerAttentionPoolEnabled.checked,
        attentionPoolMinutes: Number(elements.schedulerAttentionPoolMinutes.value),
        attentionSegmentSeconds: Number(elements.schedulerAttentionSegmentSeconds.value),
        attentionMaxObservableGapSeconds: Number(
          elements.schedulerAttentionMaxGapSeconds.value
        ),
        attentionInputWindowSeconds: Number(
          elements.schedulerAttentionInputWindowSeconds.value
        ),
        attentionMediaPlaybackWeight: Number(elements.schedulerAttentionMediaWeight.value),
        attentionAudioPlaybackWeight: Number(elements.schedulerAttentionAudioWeight.value),
        attentionLinkInteractionSoftDecaySeconds: Number(
          elements.schedulerAttentionLinkSoftSeconds.value
        ),
        attentionLinkInteractionSoftDecayWeight: Number(
          elements.schedulerAttentionLinkSoftWeight.value
        ),
        attentionLinkInteractionHardDecaySeconds: Number(
          elements.schedulerAttentionLinkHardSeconds.value
        ),
        attentionLinkInteractionHardDecayWeight: Number(
          elements.schedulerAttentionLinkHardWeight.value
        ),
        attentionLinkInteractionZeroSeconds: Number(
          elements.schedulerAttentionLinkZeroSeconds.value
        ),
        attentionSiteShareRatio: Number(elements.schedulerAttentionSiteShareRatio.value),
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
      elements.schedulerAttentionPoolEnabled.checked =
        schedulerSettings.attentionPoolEnabled !== false;
      elements.schedulerAttentionPoolMinutes.value = String(
        schedulerSettings.attentionPoolMinutes
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
      elements.schedulerAttentionLinkSoftSeconds.value = String(
        schedulerSettings.attentionLinkInteractionSoftDecaySeconds
      );
      elements.schedulerAttentionLinkSoftWeight.value = String(
        schedulerSettings.attentionLinkInteractionSoftDecayWeight
      );
      elements.schedulerAttentionLinkHardSeconds.value = String(
        schedulerSettings.attentionLinkInteractionHardDecaySeconds
      );
      elements.schedulerAttentionLinkHardWeight.value = String(
        schedulerSettings.attentionLinkInteractionHardDecayWeight
      );
      elements.schedulerAttentionLinkZeroSeconds.value = String(
        schedulerSettings.attentionLinkInteractionZeroSeconds
      );
      elements.schedulerAttentionSiteShareRatio.value = String(
        schedulerSettings.attentionSiteShareRatio
      );
      syncAttentionPoolFieldState(schedulerSettings);
    }

    function syncAttentionPoolFieldState(schedulerSettings) {
      const enabled = schedulerSettings.attentionPoolEnabled !== false;
      const group = elements.schedulerAttentionPoolEnabled?.closest(".scheduler-group");

      group?.classList.toggle("has-disabled-attention-pool", !enabled);

      for (const element of [
        elements.schedulerAttentionPoolMinutes,
        elements.schedulerAttentionSegmentSeconds,
        elements.schedulerAttentionMaxGapSeconds,
        elements.schedulerAttentionInputWindowSeconds,
        elements.schedulerAttentionMediaWeight,
        elements.schedulerAttentionAudioWeight,
        elements.schedulerAttentionLinkSoftSeconds,
        elements.schedulerAttentionLinkSoftWeight,
        elements.schedulerAttentionLinkHardSeconds,
        elements.schedulerAttentionLinkHardWeight,
        elements.schedulerAttentionLinkZeroSeconds,
        elements.schedulerAttentionSiteShareRatio,
      ]) {
        if (element) {
          element.disabled = !enabled;
        }
      }
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
