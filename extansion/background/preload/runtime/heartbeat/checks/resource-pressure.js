(function () {
  async function run(settings = getEffectiveExtensionSettings(), options = {}) {
    return getPreloadResourcePressureState(settings, options);
  }

  globalThis.ZeroLatencyPreloadHeartbeatResourcePressureCheck = {
    run,
  };
})();
