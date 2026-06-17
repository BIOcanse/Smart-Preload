(() => {
  const constants = globalThis.ZeroLatencySettingsAppUpdateConstants;
  const versionApi = globalThis.ZeroLatencySettingsAppUpdateVersion;

  function buildUpgradeableCatalog(releases, currentVersion) {
    const entriesByVersion = new Map();

    entriesByVersion.set(currentVersion, {
      version: currentVersion,
      current: true,
      releaseUrl: constants.RELEASES_PAGE_URL,
      assetName: "",
      assetUrl: "",
    });

    for (const release of releases) {
      if (release?.draft === true || release?.prerelease === true) {
        continue;
      }

      const version = versionApi.normalizeVersion(release?.tag_name || release?.name);
      if (!version || versionApi.compareVersions(version, currentVersion) < 0) {
        continue;
      }

      const assetName = `${constants.APP_ASSET_NAME_PREFIX}${version}${constants.APP_ASSET_NAME_SUFFIX}`;
      const asset = Array.isArray(release?.assets)
        ? release.assets.find((candidate) => candidate?.name === assetName)
        : null;

      if (!asset?.browser_download_url) {
        continue;
      }

      entriesByVersion.set(version, {
        version,
        current: version === currentVersion,
        releaseUrl: release.html_url || constants.RELEASES_PAGE_URL,
        releaseName: release.name || release.tag_name || `v${version}`,
        assetName,
        assetUrl: asset.browser_download_url,
      });
    }

    return [...entriesByVersion.values()].sort((left, right) =>
      versionApi.compareVersions(left.version, right.version)
    );
  }

  globalThis.ZeroLatencySettingsAppUpdateCatalog = {
    buildUpgradeableCatalog,
  };
})();
