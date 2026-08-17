(() => {
  // 本地威胁库的快照日期与加载状态。
  //
  // 这是一份**只在打包时更新**的安全数据（单一来源 URLhaus，约 7.5 万条 URL 指纹 +
  // 3.1 万条主机指纹）。此前 settings/ 和 popup/ 里搜不到任何 generatedAt —— 用户既
  // 看不到它有多旧，也不知道加载是否失败了。而 inspectUrl 现在是 fail-closed 的：
  // 库不可用时**全部预加载都会被拦下**，那种情况下用户更需要看到原因。
  //
  // 复用既有的 visit-graph:get-debug-snapshot，不新增消息类型。
  const STALE_AFTER_DAYS = 30;

  function initializeThreatLibraryStatus({ translate } = {}) {
    const element = document.getElementById("threat-library-status");

    if (!element) {
      return;
    }

    const t =
      typeof translate === "function"
        ? translate
        : (key, substitutions, fallback) => fallback || key;

    void refresh(element, t);
  }

  async function refresh(element, t) {
    let status = null;

    try {
      const snapshot = await chrome.runtime.sendMessage({
        type: "visit-graph:get-debug-snapshot",
        mode: "threat-library-status",
      });
      status = snapshot?.threatLibrary ?? null;
    } catch (error) {
      console.debug("Could not read the threat library status.", error);
    }

    applyStatus(element, t, status);
  }

  function applyStatus(element, t, status) {
    // 一旦这里写入文字，data-i18n 的自动翻译就不该再覆盖它。
    element.removeAttribute("data-i18n");
    element.classList.remove("is-warning", "is-error");

    if (!status || status.state === "failed") {
      element.classList.add("is-error");
      element.textContent = t(
        "settingsThreatLibraryFailed",
        [],
        "Failed to load. Preloading stays blocked until it loads."
      );
      return;
    }

    if (status.state !== "ready") {
      element.textContent = t("settingsThreatLibraryLoading", [], "Checking...");
      return;
    }

    const sources = (status.sourceIds || []).join(", ") || "-";
    const generatedAt = formatSnapshotDate(status.generatedAt);
    const ageDays = snapshotAgeInDays(status.generatedAt);

    element.textContent = t("settingsThreatLibraryReady", [generatedAt, sources],
      `Snapshot ${generatedAt} · ${sources}`);

    // 只提示、不报错：快照旧不代表坏，但用户有权知道。
    if (ageDays !== null && ageDays > STALE_AFTER_DAYS) {
      element.classList.add("is-warning");
      element.textContent += ` · ${t(
        "settingsThreatLibraryStale",
        [String(ageDays)],
        `${ageDays} days old`
      )}`;
    }
  }

  function formatSnapshotDate(rawValue) {
    const timestamp = Date.parse(String(rawValue || ""));

    if (!Number.isFinite(timestamp)) {
      return "-";
    }

    return new Date(timestamp).toISOString().slice(0, 10);
  }

  function snapshotAgeInDays(rawValue) {
    const timestamp = Date.parse(String(rawValue || ""));

    if (!Number.isFinite(timestamp)) {
      return null;
    }

    return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  }

  globalThis.ZeroLatencySettingsThreatLibraryStatus = {
    initializeThreatLibraryStatus,
    applyStatus,
    formatSnapshotDate,
    snapshotAgeInDays,
  };
})();
