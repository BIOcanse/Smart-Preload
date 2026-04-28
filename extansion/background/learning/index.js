(function () {
  async function handleForegroundPageDigest(message, sender) {
    return globalThis.ZeroLatencyLearningForegroundPages.handleForegroundPageDigest(
      message,
      sender
    );
  }

  async function rememberSourcePage(message, sender) {
    return globalThis.ZeroLatencyLearningLinkBehavior.rememberSourcePage(message, sender);
  }

  async function recordLinkBehavior(message, sender) {
    return globalThis.ZeroLatencyLearningLinkBehavior.recordLinkBehavior(message, sender);
  }

  async function noteUserNavigationOverride(message, sender) {
    return globalThis.ZeroLatencyLearningLinkBehavior.noteUserNavigationOverride(
      message,
      sender
    );
  }

  async function applyCreatedNavigationTargetLinkBehavior(trackingState, details) {
    return globalThis.ZeroLatencyLearningLinkBehavior.applyCreatedNavigationTargetLinkBehavior(
      trackingState,
      details
    );
  }

  function isKeywordEntryExpired(pageKeywordEntry) {
    return globalThis.ZeroLatencyLearningForegroundPages.isKeywordEntryExpired(
      pageKeywordEntry
    );
  }

  globalThis.ZeroLatencyLearning = {
    handleForegroundPageDigest,
    rememberSourcePage,
    recordLinkBehavior,
    noteUserNavigationOverride,
    applyCreatedNavigationTargetLinkBehavior,
    isKeywordEntryExpired,
  };
})();
