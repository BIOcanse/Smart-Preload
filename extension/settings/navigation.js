(() => {
  const DEFAULT_SECTION_IDS = ["tracking", "preload", "experiments"];
  const DEFAULT_SECTION_GROUPS = {
    tracking: ["tracking"],
    preload: ["preload"],
    experiments: ["experiments"],
  };

  let navButtons = [];
  let sectionIds = DEFAULT_SECTION_IDS;
  let sectionGroups = DEFAULT_SECTION_GROUPS;
  let pendingSyncFrame = null;
  let initialized = false;

  function initialize(options = {}) {
    if (initialized) {
      return;
    }

    initialized = true;
    sectionIds = Array.isArray(options.sectionIds) ? options.sectionIds : DEFAULT_SECTION_IDS;
    sectionGroups = options.sectionGroups || DEFAULT_SECTION_GROUPS;
    navButtons = Array.from(document.querySelectorAll(".settings-nav-item"));

    for (const button of navButtons) {
      button.addEventListener("click", () => {
        const targetId = button.dataset.sectionTarget;
        activate(targetId);
        scrollToSection(targetId);
      });
    }

    window.addEventListener("scroll", syncForScrollPosition, {
      passive: true,
    });
    window.addEventListener("resize", queueSync);
  }

  function activate(sectionId) {
    for (const button of navButtons) {
      button.classList.toggle("active", button.dataset.sectionTarget === sectionId);
    }
  }

  function scrollToSection(sectionId) {
    const scrollTargets = buildScrollTargets();
    const targetScrollTop = scrollTargets.get(sectionId) ?? 0;

    window.scrollTo({
      top: targetScrollTop,
      behavior: "smooth",
    });
  }

  function syncForScrollPosition() {
    const scrollTargets = buildScrollTargets();
    activate(getActiveSectionId(window.scrollY, scrollTargets));
  }

  function queueSync() {
    if (pendingSyncFrame != null) {
      cancelAnimationFrame(pendingSyncFrame);
    }

    pendingSyncFrame = requestAnimationFrame(() => {
      pendingSyncFrame = null;
      syncForScrollPosition();
    });
  }

  function buildScrollTargets() {
    const maxScrollTop = getMaxPageScrollTop();
    const sectionWeights = getSectionWeights();
    const totalWeight = sectionWeights.reduce((sum, { weight }) => sum + weight, 0);
    let consumedWeight = 0;

    return new Map(
      sectionWeights.map(({ sectionId, weight }) => {
        const targetScrollTop =
          totalWeight > 0
            ? clampScrollTop((consumedWeight / totalWeight) * maxScrollTop, maxScrollTop)
            : 0;
        consumedWeight += weight;
        return [sectionId, targetScrollTop];
      })
    );
  }

  function getActiveSectionId(scrollTop, scrollTargets) {
    const targetValues = sectionIds.map((sectionId) => scrollTargets.get(sectionId) ?? 0);

    for (let index = 0; index < targetValues.length - 1; index += 1) {
      const currentTarget = targetValues[index];
      const nextTarget = targetValues[index + 1];
      const boundary = currentTarget + (nextTarget - currentTarget) / 2;

      if (scrollTop < boundary) {
        return sectionIds[index];
      }
    }

    return sectionIds[sectionIds.length - 1];
  }

  function getMaxPageScrollTop() {
    return Math.max(
      0,
      (document.documentElement?.scrollHeight ?? 0) - window.innerHeight
    );
  }

  function getSectionWeights() {
    return sectionIds.map((sectionId) => ({
      sectionId,
      weight: getSectionGroupHeight(sectionId),
    }));
  }

  function getSectionGroupHeight(sectionId) {
    const groupIds = sectionGroups[sectionId] ?? [sectionId];
    const totalHeight = groupIds.reduce((sum, groupId) => {
      const element = document.getElementById(groupId);

      if (!element) {
        return sum;
      }

      return sum + element.getBoundingClientRect().height;
    }, 0);

    return Math.max(1, Math.round(totalHeight));
  }

  function clampScrollTop(value, maxScrollTop) {
    return Math.max(0, Math.min(maxScrollTop, Math.round(value)));
  }

  globalThis.ZeroLatencySettingsNavigation = {
    initialize,
    activate,
    queueSync,
  };
})();
