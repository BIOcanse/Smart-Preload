(function () {
  const FORM_INPUT_DEBOUNCE_MS = 250;

  function bindSettingsPageEvents(context, actions) {
    const pendingInputs = new Map();
    let formChangeQueue = Promise.resolve();

    for (const element of Object.values(context.formElements)) {
      if (!element) {
        continue;
      }

      if (getControlEventType(element) === "change") {
        element.addEventListener("change", (event) => {
          void queueFormChange(event);
        });
      } else {
        element.addEventListener("input", (event) => {
          scheduleInput(event.target);
        });
      }
    }

    context.ruleCardController.bind();

    context.saveButton.addEventListener("click", () => {
      void invokeAction(async () => {
        context.ruleCardController.flushPendingChanges?.();
        await flushPendingInputs();
        await formChangeQueue;
        await actions.saveCurrentSettings();
      });
    });

    context.resetButton.addEventListener("click", () => {
      cancelPendingInputs();
      context.ruleCardController.cancelPendingChanges?.();
      void invokeAction(async () => {
        await formChangeQueue;
        await actions.resetDraftSettings();
      });
    });

    function scheduleInput(target) {
      const pending = pendingInputs.get(target);

      if (pending) {
        clearTimeout(pending.timerId);
      }

      pendingInputs.set(target, {
        target,
        timerId: setTimeout(() => {
          pendingInputs.delete(target);
          void queueFormChange(createInputEvent(target));
        }, FORM_INPUT_DEBOUNCE_MS),
      });
    }

    async function flushPendingInputs() {
      const entries = Array.from(pendingInputs.values());
      pendingInputs.clear();

      for (const entry of entries) {
        clearTimeout(entry.timerId);
        await queueFormChange(createInputEvent(entry.target));
      }
    }

    function cancelPendingInputs() {
      for (const entry of pendingInputs.values()) {
        clearTimeout(entry.timerId);
      }
      pendingInputs.clear();
    }

    function queueFormChange(event) {
      formChangeQueue = formChangeQueue
        .then(() => actions.handleFormChange(event))
        .catch((error) => {
          console.error(error);
        });
      return formChangeQueue;
    }
  }

  function getControlEventType(element) {
    const tagName = String(element?.tagName || "").toUpperCase();
    const inputType = String(element?.type || "").toLowerCase();

    return tagName === "SELECT" || inputType === "checkbox" || inputType === "radio"
      ? "change"
      : "input";
  }

  function createInputEvent(target) {
    return {
      type: "input",
      target,
      currentTarget: target,
    };
  }

  async function invokeAction(action, ...args) {
    try {
      await action?.(...args);
    } catch (error) {
      console.error(error);
    }
  }

  globalThis.ZeroLatencySettingsPageEvents = {
    FORM_INPUT_DEBOUNCE_MS,
    bindSettingsPageEvents,
    getControlEventType,
  };
})();
