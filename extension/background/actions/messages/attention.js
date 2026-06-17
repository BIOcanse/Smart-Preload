(function () {
  function recordCandidateScanAttention(message, sender) {
    void globalThis.ZeroLatencyPreloadSchedulerAttention?.recordActiveTabAttentionFromSender?.(
      sender,
      "preload-candidate-scan",
      {
        activity: message?.attentionActivity ?? null,
      }
    )?.catch?.((error) => {
      console.debug("Failed to record preload candidate attention.", error);
    });
  }

  function recordForegroundDigestAttention(message, sender) {
    void globalThis.ZeroLatencyPreloadSchedulerAttention?.recordActiveTabAttentionFromSender?.(
      sender,
      "foreground-page-digest",
      {
        activity: message?.attentionActivity ?? null,
      }
    )?.catch?.((error) => {
      console.debug("Failed to record foreground digest attention.", error);
    });
  }

  async function recordAttentionActivity(message, sender) {
    await globalThis.ZeroLatencyPreloadSchedulerAttention?.recordActiveTabAttentionFromSender?.(
      sender,
      "content-attention-activity",
      {
        activity: message?.activity ?? message,
      }
    );
    return { ok: true };
  }

  globalThis.ZeroLatencyMessageActionAttention = {
    recordCandidateScanAttention,
    recordForegroundDigestAttention,
    recordAttentionActivity,
  };
})();
