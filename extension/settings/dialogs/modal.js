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

    function confirmText(options = {}) {
      return confirm({
        ...options,
        textInput: {
          expectedValue: options.expectedText || options.expectedValue || "",
          label:
            options.inputLabel ||
            t("settingsDialogTypedConfirmationInputLabel", [], "Type the confirmation text"),
          instruction: options.inputInstruction || "",
          errorText:
            options.inputErrorText ||
            t(
              "settingsDialogTypedConfirmationMismatch",
              [],
              "The text must match exactly before you can continue."
            ),
        },
        initialFocus: "input",
      });
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
      const textInputControl = appendTextInput(body, options.textInput, id);
      dialog.append(body);

      const footer = document.createElement("footer");
      footer.className = "settings-dialog-actions";
      const buttons = [];
      for (const action of Array.isArray(options.actions) ? options.actions : []) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `settings-dialog-button ${action.className || "ghost-button"}`;
        button.textContent = String(action.label || action.id || "");
        button.addEventListener("click", () => {
          if (
            action.id === "confirm" &&
            textInputControl &&
            !textInputControl.validate({ showError: true })
          ) {
            return;
          }
          close(action.id || "");
        });
        footer.append(button);
        buttons.push({ action, button });
      }
      textInputControl?.bindConfirmButton?.(
        buttons.find((entry) => entry.action.id === "confirm")?.button
      );
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
        options.initialFocus === "input"
          ? textInputControl?.input
          : buttons.find((entry) => entry.action.id === options.initialFocus)?.button ||
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
      confirmText,
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

  function appendTextInput(container, options, id) {
    if (!options || typeof options !== "object") {
      return null;
    }

    const expectedValue = String(options.expectedValue || "");
    if (!expectedValue) {
      return null;
    }

    const section = document.createElement("div");
    section.className = "settings-dialog-text-confirmation";

    appendParagraph(section, options.instruction);

    const expected = document.createElement("div");
    expected.className = "settings-dialog-expected-text";
    expected.textContent = expectedValue;
    section.append(expected);

    const label = document.createElement("label");
    label.className = "settings-dialog-input-label";
    label.setAttribute("for", `${id}-confirmation-input`);

    const labelText = document.createElement("span");
    labelText.textContent = String(options.label || "");
    label.append(labelText);

    const input = document.createElement("input");
    input.id = `${id}-confirmation-input`;
    input.className = "settings-dialog-text-input";
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-describedby", `${id}-confirmation-error`);
    label.append(input);
    section.append(label);

    const error = document.createElement("p");
    error.id = `${id}-confirmation-error`;
    error.className = "settings-dialog-input-error is-hidden";
    error.textContent = String(options.errorText || "");
    section.append(error);

    container.append(section);

    let confirmButton = null;
    const normalize = (value) => String(value || "").trim();

    function isValid() {
      return normalize(input.value) === normalize(expectedValue);
    }

    function validate({ showError = false } = {}) {
      const valid = isValid();
      if (confirmButton) {
        confirmButton.disabled = !valid;
        confirmButton.setAttribute("aria-disabled", valid ? "false" : "true");
      }
      error.classList.toggle("is-hidden", valid || !showError);
      input.setAttribute("aria-invalid", valid ? "false" : "true");
      if (!valid && showError) {
        input.focus({ preventScroll: true });
      }
      return valid;
    }

    input.addEventListener("input", () => validate());

    return {
      input,
      bindConfirmButton(button) {
        confirmButton = button || null;
        validate();
      },
      validate,
    };
  }

  globalThis.ZeroLatencySettingsDialogModal = {
    createStandardDialog,
  };
})();
