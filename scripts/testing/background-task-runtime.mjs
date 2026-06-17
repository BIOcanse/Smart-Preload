import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const modelSource = await readFile(
  new URL("../../extension/background/core/tasks/model.js", import.meta.url),
  "utf8"
);
const storeUtilsSource = await readFile(
  new URL("../../extension/background/core/tasks/runtime/store/utils.js", import.meta.url),
  "utf8"
);
const storeLogsSource = await readFile(
  new URL("../../extension/background/core/tasks/runtime/store/logs.js", import.meta.url),
  "utf8"
);
const storeLifecycleSource = await readFile(
  new URL("../../extension/background/core/tasks/runtime/store/lifecycle.js", import.meta.url),
  "utf8"
);
const storeSnapshotSource = await readFile(
  new URL("../../extension/background/core/tasks/runtime/store/snapshot.js", import.meta.url),
  "utf8"
);
const storeSource = await readFile(
  new URL("../../extension/background/core/tasks/runtime/store.js", import.meta.url),
  "utf8"
);
const queueSource = await readFile(
  new URL("../../extension/background/core/tasks/runtime/queue.js", import.meta.url),
  "utf8"
);
const runtimeSource = await readFile(
  new URL("../../extension/background/core/tasks/runtime.js", import.meta.url),
  "utf8"
);

const context = vm.createContext({
  console,
  Date,
  JSON,
  Map,
  Promise,
  Set,
  String,
  globalThis: {},
});
vm.runInContext(modelSource, context, {
  filename: "tasks/model.js",
});
vm.runInContext(storeUtilsSource, context, {
  filename: "tasks/runtime/store/utils.js",
});
vm.runInContext(storeLogsSource, context, {
  filename: "tasks/runtime/store/logs.js",
});
vm.runInContext(storeLifecycleSource, context, {
  filename: "tasks/runtime/store/lifecycle.js",
});
vm.runInContext(storeSnapshotSource, context, {
  filename: "tasks/runtime/store/snapshot.js",
});
vm.runInContext(storeSource, context, {
  filename: "tasks/runtime/store.js",
});
vm.runInContext(queueSource, context, {
  filename: "tasks/runtime/queue.js",
});
vm.runInContext(runtimeSource, context, {
  filename: "tasks/runtime.js",
});

const tasks = context.globalThis.ZeroLatencyBackgroundTasks;
assert.equal(typeof tasks.submitTask, "function");
assert.equal(typeof tasks.getTask, "function");
assert.equal(typeof tasks.getSnapshot, "function");

const executionOrder = [];
const firstTask = tasks.submitTask({
  kind: "test.serial",
  queueId: "test",
  title: "First",
  run: async (taskContext) => {
    executionOrder.push("first:start");
    taskContext.setProgress({
      step: "mid",
      message: "First running",
      progress: {
        percent: 50,
      },
    });
    executionOrder.push("first:end");
    return {
      ok: true,
      value: 1,
    };
  },
});
const secondTask = tasks.submitTask({
  kind: "test.serial",
  queueId: "test",
  title: "Second",
  run: async () => {
    executionOrder.push("second");
    return {
      ok: true,
      value: 2,
    };
  },
});

assert.match(firstTask.taskId, /^task_/u);
assert.equal(firstTask.status, "queued");
assert.equal(secondTask.status, "queued");

await waitForCompleted(firstTask.taskId);
await waitForCompleted(secondTask.taskId);

assert.deepEqual(executionOrder, ["first:start", "first:end", "second"]);
assert.equal(tasks.getTask(firstTask.taskId).result.value, 1);
assert.equal(tasks.getTask(secondTask.taskId).result.value, 2);

const dedupedFirst = tasks.submitTask({
  kind: "test.dedupe",
  queueId: "dedupe",
  dedupeKey: "same",
  run: async () => ({ ok: true }),
});
const dedupedSecond = tasks.submitTask({
  kind: "test.dedupe",
  queueId: "dedupe",
  dedupeKey: "same",
  run: async () => ({ ok: true }),
});
assert.equal(dedupedSecond.taskId, dedupedFirst.taskId);

const snapshot = tasks.getSnapshot();
assert.equal(snapshot.ok, true);
assert.ok(snapshot.summary.total >= 3);
assert.ok(Array.isArray(snapshot.tasks));
assert.ok(Array.isArray(snapshot.recentLogs));

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "task submission",
        "queue serial execution",
        "task progress/result snapshot",
        "active task dedupe",
        "task snapshot",
      ],
    },
    null,
    2
  )
);

async function waitForCompleted(taskId) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 5000) {
    const task = tasks.getTask(taskId);
    if (task?.status === "completed") {
      return task;
    }
    if (task?.status === "failed") {
      throw new Error(task.error || "task failed");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for ${taskId}`);
}
