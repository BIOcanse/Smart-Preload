(() => {
  let dialogSequence = 0;

  function createStandardDialog({ translate } = {}) {
    const t =
      typeof translate === "function"
        ? translate
        : (key, substitutions = [], fallback = "") => fallback || key;
    let active = null;

    function confirm(options = {}) {
      return open({
        ...options,
        actions: [
          {
            id: "cancel",
            label:
              options.cancelLabel ||
              t("settingsDialogCancel", [], "Cancel"),
            className: "ghost-button",
          },
          {
            id: "confirm",
            label:
              options.confirmLabel ||
              t("settingsDialogConfirm", [], "Confirm"),
            className: options.confirmClassName || "primary-button",
          },
        ],
        initialFocus: options.initialFocus || "cancel",
      }).then((result) => result === "confirm");
    }

    function open(options = {}) {
      closeActive("replaced");

      const previousFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const id = `settings-dialog-${++dialogSequence}`;
      const backdrop = document.createElement("div");
      backdrop.className = "settings-dialog-backdrop";

      const dialog = document.createElement("section");
      dialog.className = `settings-dialog is-${options.variant || "default"}`;
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", `${id}-title`);
      dialog.tabIndex = -1;

      const header = document.createElement("header");
      header.className = "settings-dialog-header";

      const title = document.createElement("h2");
      title.id = `${id}-title`;
      title.className = "settings-dialog-title";
      title.textContent = String(options.title || "");
      header.append(title);
      dialog.append(header);

      const body = document.createElement("div");
      body.className = "settings-dialog-body";
      appendParagraph(body, options.message);
      appendParagraph(body, options.detail);
      appendList(body, options.items);
      dialog.append(body);

      const footer = document.createElement("footer");
      footer.className = "settings-dialog-actions";
      const buttons = [];
      for (const action of Array.isArray(options.actions) ? options.actions : []) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `settings-dialog-button ${action.className || "ghost-button"}`;
        button.textContent = String(action.label || action.id || "");
        button.addEventListener("click", () => close(action.id || ""));
        footer.append(button);
        buttons.push({ action, button });
      }
      dialog.append(footer);
      backdrop.append(dialog);

      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close("cancel");
        }
      };
      const onBackdropClick = (event) => {
        if (event.target === backdrop) {
          close("cancel");
        }
      };

      document.addEventListener("keydown", onKeyDown, true);
      backdrop.addEventListener("click", onBackdropClick);
      document.body.append(backdrop);

      let settle = () => {};
      const promise = new Promise((resolve) => {
        settle = resolve;
      });

      active = {
        backdrop,
        previousFocus,
        resolve: settle,
        cleanup() {
          document.removeEventListener("keydown", onKeyDown, true);
          backdrop.removeEventListener("click", onBackdropClick);
          backdrop.remove();
          active = null;
          if (previousFocus?.isConnected) {
            previousFocus.focus({ preventScroll: true });
          }
        },
      };

      const initialButton =
        buttons.find((entry) => entry.action.id === options.initialFocus)?.button ||
        buttons[0]?.button;
      window.requestAnimationFrame(() => {
        (initialButton || dialog).focus({ preventScroll: true });
      });

      function close(result) {
        if (!active || active.backdrop !== backdrop) {
          return;
        }
        const current = active;
        current.cleanup();
        current.resolve(result);
      }

      return promise;
    }

    function closeActive(result = "cancel") {
      if (!active) {
        return;
      }
      const current = active;
      current.cleanup();
      current.resolve(result);
    }

    return {
      confirm,
      close: closeActive,
    };
  }

  function appendParagraph(container, text) {
    const normalized = String(text || "").trim();
    if (!normalized) {
      return;
    }
    const paragraph = document.createElement("p");
    paragraph.textContent = normalized;
    container.append(paragraph);
  }

  function appendList(container, items) {
    if (!Array.isArray(items) || items.length === 0) {
      return;
    }

    const list = document.createElement("ul");
    list.className = "settings-dialog-list";
    for (const itemText of items) {
      const normalized = String(itemText || "").trim();
      if (!normalized) {
        continue;
      }
      const item = document.createElement("li");
      item.textContent = normalized;
      list.append(item);
    }
    if (list.childElementCount > 0) {
      container.append(list);
    }
  }

  globalThis.ZeroLatencySettingsDialogModal = {
    createStandardDialog,
  };
})();
