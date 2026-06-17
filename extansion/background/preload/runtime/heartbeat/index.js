(function () {
  async function collectVerdicts(settings = getEffectiveExtensionSettings(), options = {}) {
    const checks = [
      {
        key: "resourcePressure",
        run: () =>
          globalThis.ZeroLatencyPreloadHeartbeatResourcePressureCheck.run(settings, {
            ...(options.resourcePressure || {}),
          }),
      },
      {
        key: "performanceWarning",
        run: () =>
          globalThis.ZeroLatencyPreloadHeartbeatPerformanceWarningCheck.run(settings, {
            requireCachedAvailability: true,
            timeoutMs: 1000,
            ...(options.performanceWarning || {}),
          }),
      },
    ];
    const checkedAt = new Date().toISOString();
    const results = await Promise.all(
      checks.map(async (check) => {
        try {
          return {
            key: check.key,
            ok: true,
            state: await check.run(),
          };
        } catch (error) {
          return {
            key: check.key,
            ok: false,
            error: String(error?.message || error),
          };
        }
      })
    );
    const verdicts = {
      checkedAt,
      errors: [],
    };

    for (const result of results) {
      if (result.ok) {
        verdicts[result.key] = {
          ok: true,
          state: result.state,
        };
        continue;
      }

      verdicts[result.key] = {
        ok: false,
        error: result.error,
      };
      verdicts.errors.push(result);
    }

    if (verdicts.errors.length > 0) {
      globalThis.ZeroLatencyDebugEvents?.record?.("preload.heartbeat.check.error", {
        errors: verdicts.errors,
      });
    }

    return verdicts;
  }

  async function maintain() {
    return enforcePreloadWindowPolicy();
  }

  async function ensureSchedule() {
    return ensurePreloadWindowWatchdog();
  }

  globalThis.ZeroLatencyPreloadHeartbeat = {
    collectVerdicts,
    maintain,
    ensureSchedule,
  };
})();
