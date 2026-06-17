(function () {
  const namespace = (globalThis.ZeroLatencyNavigationContent =
    globalThis.ZeroLatencyNavigationContent || {});

  function bindNavigationLinkEvents() {
    document.addEventListener(
      "click",
      (event) => {
        void namespace.handleClick(event);
      },
      true
    );

    document.addEventListener(
      "auxclick",
      (event) => {
        void namespace.handleAuxClick(event);
      },
      true
    );

    document.addEventListener(
      "pointerover",
      (event) => {
        namespace.handleLinkHover?.(event);
      },
      true
    );

    document.addEventListener(
      "pointerout",
      (event) => {
        namespace.handleLinkHoverOut?.(event);
      },
      true
    );

    document.addEventListener(
      "contextmenu",
      (event) => {
        namespace.handleLinkContextMenu?.(event);
      },
      true
    );

    document.addEventListener("selectionchange", () => {
      namespace.cancelInteractionPreloadForSelection?.();
    });
  }

  Object.assign(namespace, {
    bindNavigationLinkEvents,
  });
})();
