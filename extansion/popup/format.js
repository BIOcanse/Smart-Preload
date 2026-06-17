(function () {
  function formatUpdatedAt(timestamp) {
    if (!timestamp) {
      return "-";
    }

    return formatTimestamp(timestamp, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatTimestamp(timestamp, options = null) {
    if (!timestamp) {
      return "-";
    }

    return new Date(timestamp).toLocaleString(
      undefined,
      options ?? {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }
    );
  }

  function truncateUrl(url) {
    if (!url) {
      return "-";
    }

    return url.length > 60 ? `${url.slice(0, 57)}...` : url;
  }

  function formatWeight(score) {
    const numericScore = Number(score);

    if (!Number.isFinite(numericScore)) {
      return "-";
    }

    return numericScore.toFixed(3);
  }

  function formatSiteSelectionMeta(siteSelection, translate) {
    if (!siteSelection || !Number.isFinite(Number(siteSelection.siteWeight))) {
      return "";
    }

    return translate(
      "popupSiteMeta",
      [
        formatWeight(siteSelection.siteWeight),
        siteSelection.siteRank || 0,
        siteSelection.allocatedSlots || 0,
        siteSelection.cap || 0,
      ],
      `Site: ${formatWeight(siteSelection.siteWeight)} (#${siteSelection.siteRank || 0}, ${siteSelection.allocatedSlots || 0}/${siteSelection.cap || 0})`
    );
  }

  function formatTransitionMetricMeta(transitionMetrics, translate) {
    if (!transitionMetrics) {
      return "";
    }

    const siteCount = Number(transitionMetrics.siteTransitionCount) || 0;
    const outboundPageCount = Number(transitionMetrics.outboundPageTransitionCount) || 0;
    const intraSitePageCount = Number(transitionMetrics.intraSitePageTransitionCount) || 0;

    if (siteCount === 0 && outboundPageCount === 0 && intraSitePageCount === 0) {
      return "";
    }

    return translate(
      "popupFreqMeta",
      [siteCount, outboundPageCount, intraSitePageCount],
      `Freq: site ${siteCount}, out ${outboundPageCount}, in ${intraSitePageCount}`
    );
  }

  function formatBookmarkPreloadMeta(bookmarkPreload, translate) {
    if (!bookmarkPreload) {
      return "";
    }

    const count = Number(bookmarkPreload.count) || 0;
    const rank = Number(bookmarkPreload.rank) || 0;

    if (count === 0 && rank === 0) {
      return "";
    }

    return translate(
      "popupBookmarkMeta",
      [count, rank],
      `Bookmark: ${count}, rank ${rank}`
    );
  }

  globalThis.ZeroLatencyPopupFormat = {
    formatUpdatedAt,
    formatTimestamp,
    truncateUrl,
    formatWeight,
    formatSiteSelectionMeta,
    formatTransitionMetricMeta,
    formatBookmarkPreloadMeta,
  };
})();
