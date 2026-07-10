import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourcePaths = [
  "extension/background/core/tasks/model.js",
  "extension/background/core/tasks/runtime/store/utils.js",
  "extension/background/core/tasks/runtime/store/logs.js",
  "extension/background/core/tasks/runtime/store/lifecycle.js",
  "extension/background/core/tasks/runtime/store/snapshot.js",
  "extension/background/core/tasks/runtime/store.js",
  "extension/background/core/tasks/runtime/persistence.js",
];
const storageValues = new Map([
  [
    "backgroundTaskSnapshotV1",
    [
      createStoredTask("running-task", "running"),
      createStoredTask("completed-task", "completed"),
    ],
  ],
]);
const context = vm.createContext({
  console,
  Date,
  Map,
  Math,
  Object,
  Promise,
  Set,
  clearTimeout,
  setTimeout,
});
context.globalThis = context;
context.chrome = {
  storage: {
    local: {
      async get(defaults) {
        return Object.fromEntries(
          Object.entries(defaults).map(([key, fallback]) => [
            key,
            storageValues.has(key) ? storageValues.get(key) : fallback,
          ])
        );
      },
      async set(entries) {
        for (const [key, value] of Object.entries(entries)) {
          storageValues.set(key, JSON.parse(JSON.stringify(value)));
        }
      },
    },
  },
};

for (const relativePath of sourcePaths) {
  const sourcePath = path.join(repositoryRoot, relativePath);
  vm.runInContext(readFileSync(sourcePath, "utf8"), context, { filename: sourcePath });
}

await context.ZeroLatencyBackgroundTaskPersistence.restore(
  context.ZeroLatencyBackgroundTaskStore
);
const interrupted = context.ZeroLatencyBackgroundTaskStore.getTask("running-task");
const completed = context.ZeroLatencyBackgroundTaskStore.getTask("completed-task");
assert.equal(interrupted.status, "failed");
assert.equal(interrupted.step, "interrupted");
assert.match(interrupted.error, /background service restarted/u);
assert.equal(completed.status, "completed");

context.ZeroLatencyBackgroundTaskStore.createTaskFromSubmission({
  kind: "test.persist",
  queueId: "test",
  run: async () => ({ ok: true }),
});
await context.ZeroLatencyBackgroundTaskPersistence.persist(
  context.ZeroLatencyBackgroundTaskStore
);
assert.equal(storageValues.get("backgroundTaskSnapshotV1").length, 3);
assert.ok(
  storageValues
    .get("backgroundTaskSnapshotV1")
    .every((task) => task.run === undefined),
  "persisted snapshots must not contain executable handlers"
);

console.log("background task persistence tests passed");

function createStoredTask(taskId, status) {
  const timestamp = "2026-07-10T00:00:00.000Z";
  return {
    taskId,
    kind: "test",
    queueId: "test",
    title: "Test",
    description: "",
    dedupeKey: "",
    status,
    step: status,
    message: status,
    progress: { percent: status === "completed" ? 100 : 50 },
    result: status === "completed" ? { ok: true } : null,
    error: "",
    createdAt: timestamp,
    queuedAt: timestamp,
    startedAt: timestamp,
    completedAt: status === "completed" ? timestamp : null,
    updatedAt: timestamp,
    logs: [],
  };
}
