(function () {
  const APP_UPDATE_STATUS_PATH = "/api/v1/app/update/status";
  const APP_UPDATE_REQUEST_PATH = "/api/v1/app/update";
  // 与 Rust 侧 app/src/update/model.rs:7-8 的两个常量保持一致。
  // 那边有前缀校验兜底，但扩展侧必须**独立**校验：这条消息把调用方给的 assetUrl 原样
  // 交给本地更新器去下载并执行，不能把「对方会检查」当成自己的控制措施。
  const RELEASE_ASSET_URL_PREFIX =
    "https://github.com/BIOcanse/Smart-Preload/releases/download/";
  const RELEASE_TAG_URL_PREFIX = "https://github.com/BIOcanse/Smart-Preload/releases/tag/";

  // 前缀比较之前先按 URL 解析并规范化，避免 `https://github.com@evil.test/…`、
  // 反斜杠、百分号编码这类靠字符串前缀匹配骗过去的写法。
  function hasReleaseUrlPrefix(rawUrl, expectedPrefix) {
    try {
      const url = new URL(String(rawUrl || ""));

      if (url.protocol !== "https:" || url.username || url.password) {
        return false;
      }

      return url.href.startsWith(expectedPrefix);
    } catch (_error) {
      return false;
    }
  }

  async function handleNativeAppUpdateStatus() {
    const response = await fetchNativeApp(APP_UPDATE_STATUS_PATH, {
      method: "GET",
      timeoutMs: 2500,
    });

    return {
      ok: response?.ok === true,
      currentVersion: String(response?.currentVersion || ""),
      updateSupported: response?.updateSupported === true,
      updaterStatus: response?.updaterStatus || "",
    };
  }

  async function handleNativeAppUpdateToVersion(message) {
    const targetVersion = String(message?.targetVersion || "").trim();
    const assetName = String(message?.assetName || "").trim();
    const assetUrl = String(message?.assetUrl || "").trim();
    const releaseUrl = String(message?.releaseUrl || "").trim();

    if (!targetVersion || !assetName || !assetUrl) {
      throw new Error("Native app update request is incomplete.");
    }

    if (!hasReleaseUrlPrefix(assetUrl, RELEASE_ASSET_URL_PREFIX)) {
      throw new Error("Native app update asset URL is not an official release asset.");
    }

    if (releaseUrl && !hasReleaseUrlPrefix(releaseUrl, RELEASE_TAG_URL_PREFIX)) {
      throw new Error("Native app update release URL is not an official release page.");
    }

    const task = globalThis.ZeroLatencyBackgroundTasks.submitTask({
      kind: "native-app.update",
      queueId: "native-app",
      title: `Native app update ${targetVersion}`,
      description: "Update the Windows native app through the local app updater.",
      dedupeKey: `native-app.update:${targetVersion}`,
      run: async (context) => {
        context.setProgress({
          step: "requesting-native-app",
          message: `Starting native app update to v${targetVersion}.`,
          progress: {
            percent: 20,
          },
        });

        const response = await fetchNativeApp(APP_UPDATE_REQUEST_PATH, {
          method: "POST",
          timeoutMs: 5000,
          body: {
            targetVersion,
            assetName,
            assetUrl,
            releaseUrl,
          },
        });

        if (response?.ok !== true) {
          throw new Error(response?.error || response?.message || "native app update request failed");
        }

        context.setProgress({
          step: "accepted",
          message: `Native app update to v${targetVersion} accepted.`,
          progress: {
            percent: 100,
          },
        });

        return response;
      },
    });

    return {
      ok: true,
      taskId: task.taskId,
      task,
    };
  }

  globalThis.ZeroLatencyCoreNativeAppUpdateMessages = {
    handleNativeAppUpdateStatus,
    handleNativeAppUpdateToVersion,
  };
})();
