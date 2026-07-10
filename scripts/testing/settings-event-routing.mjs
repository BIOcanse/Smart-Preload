import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

class FakeElement {
  constructor(tagName, type) {
    this.tagName = tagName;
    this.type = type;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ type, target: this, currentTarget: this });
    }
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const context = vm.createContext({
  console,
  globalThis: null,
  Map,
  Promise,
  String,
  clearTimeout,
  setTimeout,
});
context.globalThis = context;

const source = await readFile(
  path.join(repoRoot, "extension", "settings", "page", "events.js"),
  "utf8"
);
vm.runInContext(source, context, { filename: "settings/page/events.js" });

const api = context.ZeroLatencySettingsPageEvents;
assert.equal(api.FORM_INPUT_DEBOUNCE_MS, 250);

const checkbox = new FakeElement("INPUT", "checkbox");
const select = new FakeElement("SELECT", "select-one");
const text = new FakeElement("INPUT", "text");
const number = new FakeElement("INPUT", "number");
const saveButton = new FakeElement("BUTTON", "button");
const resetButton = new FakeElement("BUTTON", "button");
const handledTargets = [];
let saved = 0;
let reset = 0;
let ruleCardFlushes = 0;
let ruleCardCancels = 0;

api.bindSettingsPageEvents(
  {
    formElements: { checkbox, select, text, number },
    saveButton,
    resetButton,
    ruleCardController: {
      bind() {},
      flushPendingChanges() {
        ruleCardFlushes += 1;
      },
      cancelPendingChanges() {
        ruleCardCancels += 1;
      },
    },
  },
  {
    async handleFormChange(event) {
      handledTargets.push(event.target);
    },
    async saveCurrentSettings() {
      saved += 1;
    },
    async resetDraftSettings() {
      reset += 1;
    },
  }
);

assert.deepEqual(Array.from(checkbox.listeners.keys()), ["change"]);
assert.deepEqual(Array.from(select.listeners.keys()), ["change"]);
assert.deepEqual(Array.from(text.listeners.keys()), ["input"]);
assert.deepEqual(Array.from(number.listeners.keys()), ["input"]);

checkbox.dispatch("input");
checkbox.dispatch("change");
await sleep(10);
assert.equal(handledTargets.filter((target) => target === checkbox).length, 1);

text.dispatch("input");
text.dispatch("input");
await sleep(api.FORM_INPUT_DEBOUNCE_MS - 25);
assert.equal(handledTargets.filter((target) => target === text).length, 0);
await sleep(50);
assert.equal(handledTargets.filter((target) => target === text).length, 1);

number.dispatch("input");
saveButton.dispatch("click");
await sleep(25);
assert.equal(handledTargets.filter((target) => target === number).length, 1);
assert.equal(ruleCardFlushes, 1);
assert.equal(saved, 1);

number.dispatch("input");
resetButton.dispatch("click");
await sleep(api.FORM_INPUT_DEBOUNCE_MS + 25);
assert.equal(handledTargets.filter((target) => target === number).length, 1);
assert.equal(ruleCardCancels, 1);
assert.equal(reset, 1);

console.log("settings event routing tests passed");

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
