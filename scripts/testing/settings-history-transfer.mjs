import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const controllerPath = path.join(
  repoRoot,
  "extension",
  "settings",
  "history-transfer",
  "controller.js"
);
const context = { console };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(readFileSync(controllerPath, "utf8"), context, {
  filename: controllerPath,
});

await testExportRequiresWarningConfirmation();
await testImportCancelDoesNotOverwrite();
await testConfirmedTransferRuns();

console.log("settings history transfer tests passed");

async function testExportRequiresWarningConfirmation() {
  let pickerCalls = 0;
  let exportCalls = 0;
  const controller = createController({
    confirm: async () => false,
    filePicker: {
      createSuggestedBackupName: () => "backup.json",
      chooseExportFile: async () => {
        pickerCalls += 1;
        return { name: "backup.json" };
      },
      writeExportFile: async () => {},
      chooseImportFile: async () => null,
    },
    service: {
      exportHistory: async () => {
        exportCalls += 1;
        return { ok: true, backup: {} };
      },
    },
  });

  await controller.handleExport();
  assert.equal(pickerCalls, 0);
  assert.equal(exportCalls, 0);
}

async function testImportCancelDoesNotOverwrite() {
  let importCalls = 0;
  const statusElement = createStatusElement();
  const footerStatuses = [];
  const controller = createController({
    confirm: async () => false,
    filePicker: {
      chooseImportFile: async () => ({ text: async () => "valid-backup" }),
    },
    service: {
      validateImport: async () => createValidation(),
      importHistory: async () => {
        importCalls += 1;
        return { ok: true, summary: { transitionMessages: 1 } };
      },
    },
    statusElement,
    setStatus: (title, message) => footerStatuses.push({ title, message }),
  });

  await controller.handleImport();
  assert.equal(importCalls, 0);
  assert.match(statusElement.textContent, /cancelled/i);
  assert.match(footerStatuses.at(-1)?.message || "", /not changed/i);
}

async function testConfirmedTransferRuns() {
  const confirmations = [];
  const writes = [];
  const imports = [];
  const options = {
    confirm: async (dialogOptions) => {
      confirmations.push(dialogOptions);
      return true;
    },
    filePicker: {
      createSuggestedBackupName: () => "smart-preload-history.json",
      chooseExportFile: async () => ({ name: "chosen-history.json" }),
      writeExportFile: async (handle, contents) => {
        writes.push({ handle, contents });
      },
      chooseImportFile: async () => ({ text: async () => "valid-backup" }),
    },
    service: {
      exportHistory: async () => ({
        ok: true,
        backup: { format: "smart-preload-history", formatVersion: 1 },
      }),
      validateImport: async () => createValidation(),
      importHistory: async (backup) => {
        imports.push(backup);
        return { ok: true, summary: { transitionMessages: 12 } };
      },
    },
  };

  const controller = createController(options);
  await controller.handleExport();
  await controller.handleImport();

  assert.equal(confirmations.length, 2);
  assert.match(confirmations[0].message, /visited addresses/i);
  assert.match(confirmations[0].detail, /responsible/i);
  assert.match(confirmations[1].message, /completely replace/i);
  assert.equal(confirmations[1].confirmClassName, "danger-button");
  assert.equal(writes.length, 1);
  assert.match(writes[0].contents, /smart-preload-history/);
  assert.equal(imports.length, 1);
  assert.equal(imports[0], "valid-backup");
}

function createController({
  confirm,
  filePicker,
  service,
  statusElement = createStatusElement(),
  setStatus = () => {},
}) {
  return context.ZeroLatencySettingsHistoryTransferController.create({
    dialogs: { confirm },
    filePicker,
    service,
    translate: (_key, _substitutions, fallback) => fallback,
    setStatus,
    controls: {
      importButton: { disabled: false },
      exportButton: { disabled: false },
      status: statusElement,
    },
  });
}

function createStatusElement() {
  return {
    textContent: "",
    classList: {
      toggle() {},
    },
  };
}

function createValidation() {
  return {
    metadata: {
      exportedAt: "2026-07-15T00:00:00.000Z",
      extensionVersion: "1.0.17",
    },
    summary: {
      transitionMessages: 12,
      sites: 4,
      pageKeywords: 3,
    },
  };
}
