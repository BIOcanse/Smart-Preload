(function () {
  // Page-side edge adapter only. All feature modules are loaded before this
  // file by manifest content_scripts order and attach to this namespace.
  const navigationContent = globalThis.ZeroLatencyNavigationContent;

  if (!navigationContent?.bindNavigationContentEvents) {
    return;
  }

  navigationContent.bindNavigationContentEvents();
})();
