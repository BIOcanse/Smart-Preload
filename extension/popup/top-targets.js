(function () {
  function renderTopTargets({
    topTargets,
    pageContext,
    serviceState,
    listElement,
    emptyElement,
    translate,
  }) {
    const format = globalThis.ZeroLatencyPopupFormat;
    listElement.textContent = "";

    if (serviceState?.paused === true) {
      emptyElement.classList.remove("hidden");
      emptyElement.textContent = translate(
        "popupPausedMessage",
        [],
        "Plugin stopped: prediction and preloading are disabled."
      );
      return;
    }

    if (!topTargets.length) {
      emptyElement.classList.remove("hidden");
      emptyElement.textContent = pageContext?.trackable
        ? translate("popupNoPreloadQualifiedLinks", [], "No preload-qualified links on this page yet.")
        : translate("popupCurrentPageNotTrackable", [], "Current page is not trackable.");
      return;
    }

    emptyElement.classList.add("hidden");

    for (const target of topTargets.slice(0, 3)) {
      const item = document.createElement("li");
      item.className = "list-item";

      const title = document.createElement("p");
      title.className = "item-title";
      title.textContent =
        target.nodeLabel || format.truncateUrl(target.loadedUrl || target.requestedUrl);

      const meta = document.createElement("p");
      meta.className = "item-meta";
      const siteMeta = format.formatSiteSelectionMeta(target.siteSelection, translate);
      const frequencyMeta = format.formatTransitionMetricMeta(target.transitionMetrics, translate);
      const bookmarkMeta = format.formatBookmarkPreloadMeta(target.bookmarkPreload, translate);
      meta.textContent = [
        translate(
          "popupWeightLabel",
          [format.formatWeight(target.score)],
          `Weight: ${format.formatWeight(target.score)}`
        ),
        frequencyMeta,
        bookmarkMeta,
        siteMeta,
        target.strategy || "hidden-tab",
        target.status || translate("commonUnknown", [], "unknown"),
        format.truncateUrl(target.loadedUrl || target.requestedUrl),
      ]
        .filter(Boolean)
        .join(" | ");

      item.append(title, meta);
      listElement.append(item);
    }
  }

  globalThis.ZeroLatencyPopupTopTargets = {
    render: renderTopTargets,
  };
})();
