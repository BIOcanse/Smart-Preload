(() => {
  const constants = globalThis.ZeroLatencySettingsAppUpdateConstants;
  const versionApi = globalThis.ZeroLatencySettingsAppUpdateVersion;
  const catalogApi = globalThis.ZeroLatencySettingsAppUpdateCatalog;
  const serviceApi = globalThis.ZeroLatencySettingsAppUpdateService;
  const viewApi = globalThis.ZeroLatencySettingsAppUpdateView;
  const i18n = globalThis.ZeroLatencyI18n;
  const t = (key, substitutions = [], fallback = "") =>
    i18n?.t?.(key, substitutions, fallback) || fallback || key;

  function createNativeAppUpdateController() {
    const view = viewApi.create();
    let initialized = false;
    let catalog = [];

    function initialize(options = {}) {
      if (initialized) {
        return;
      }

      initialized = view.initialize({
        setStatus: options.setStatus,
        onRefresh() {
          void refreshVersionCatalog();
        },
        onUpdate() {
          void requestSelectedAppUpdate();
        },
        onSelectionChange: syncUpdateButton,
      });

      if (initialized) {
        void refreshVersionCatalog();
      }
    }

    async function refreshVersionCatalog() {
      view.setBusy(true);
      view.renderStatus(t("settingsNativeAppVersionsLoading", [], "Loading versions..."));
      view.setFooterStatus(
        t("commonLoading", [], "Loading"),
        t("settingsNativeAppVersionsLoading", [], "Loading versions...")
      );

      try {
        const appStatus = await serviceApi.loadNativeAppUpdateStatus();
        const currentVersion = versionApi.normalizeVersion(appStatus.currentVersion);

        if (!currentVersion) {
          throw new Error(
            t(
              "settingsNativeAppVersionUnknown",
              [],
              "Native app version is unavailable."
            )
          );
        }

        const releases = await serviceApi.loadGitHubReleases();
        catalog = catalogApi.buildUpgradeableCatalog(releases, currentVersion);
        view.renderVersionOptions(catalog, currentVersion);
        syncUpdateButton();

        if (catalog.some((entry) => versionApi.compareVersions(entry.version, currentVersion) > 0)) {
          const message = t(
            "settingsNativeAppVersionsReady",
            [currentVersion],
            `Native app ${currentVersion}. Select a newer version to upgrade.`
          );
          view.renderStatus(message);
          view.setFooterStatus(t("commonReady", [], "Ready"), message);
        } else {
          const message = t(
            "settingsNativeAppNoUpgrade",
            [currentVersion],
            `Native app ${currentVersion} is already on the latest listed version.`
          );
          view.renderStatus(message);
          view.setFooterStatus(t("commonReady", [], "Ready"), message);
        }
      } catch (error) {
        console.error(error);
        catalog = [];
        view.renderVersionOptions([], "");
        syncUpdateButton();
        const message = t(
          "settingsNativeAppVersionsFailed",
          [constants.RELEASES_PAGE_URL],
          "Could not load app versions. Start the native app or use GitHub releases."
        );
        view.renderStatus(message, true);
        view.setFooterStatus(t("commonFailed", [], "Failed"), message);
      } finally {
        view.setBusy(false);
        syncUpdateButton();
      }
    }

    async function requestSelectedAppUpdate() {
      const entry = getSelectedCatalogEntry();

      if (!entry || entry.current || !entry.assetUrl) {
        syncUpdateButton();
        return;
      }

      const confirmed = window.confirm(
        t(
          "settingsNativeAppUpdateConfirm",
          [entry.version],
          `Upgrade the native app to v${entry.version}? The app will restart after the update starts.`
        )
      );

      if (!confirmed) {
        return;
      }

      view.setBusy(true);
      view.renderStatus(
        t(
          "settingsNativeAppUpdateStarting",
          [entry.version],
          `Starting native app update to v${entry.version}...`
        )
      );
      view.setFooterStatus(
        t("commonSaving", [], "Saving"),
        t(
          "settingsNativeAppUpdateStarting",
          [entry.version],
          `Starting native app update to v${entry.version}...`
        )
      );

      try {
        const response = await serviceApi.requestNativeAppUpdate(entry);

        await serviceApi.waitForNativeAppUpdateTask(response.taskId, {
          timeoutMs: 20_000,
          onTask(task) {
            const taskMessage = task?.message || "";
            if (taskMessage) {
              view.renderStatus(taskMessage);
              view.setFooterStatus(t("commonSaving", [], "Saving"), taskMessage);
            }
          },
        });

        const message = t(
          "settingsNativeAppUpdateAccepted",
          [entry.version],
          `Native app update to v${entry.version} has started.`
        );
        view.renderStatus(message);
        view.setFooterStatus(t("commonReady", [], "Ready"), message);
      } catch (error) {
        console.error(error);
        const message = t(
          "settingsNativeAppUpdateFailed",
          [entry.version],
          `Could not start native app update to v${entry.version}.`
        );
        view.renderStatus(message, true);
        view.setFooterStatus(t("commonFailed", [], "Failed"), message);
      } finally {
        view.setBusy(false);
        syncUpdateButton();
      }
    }

    function getSelectedCatalogEntry() {
      const version = versionApi.normalizeVersion(view.getSelectedVersion());
      return catalog.find((entry) => entry.version === version) ?? null;
    }

    function syncUpdateButton() {
      const entry = getSelectedCatalogEntry();
      view.setUpdateButtonEnabled(Boolean(entry && !entry.current && entry.assetUrl));
    }

    return {
      initialize,
      refreshVersionCatalog,
    };
  }

  globalThis.ZeroLatencySettingsAppUpdateController = {
    create: createNativeAppUpdateController,
  };
})();
