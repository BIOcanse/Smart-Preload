import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [sharedSource, schedulerSource] = await Promise.all([
  readFile(
    new URL("../../extension/scripts/navigation/shared.js", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL("../../extension/scripts/navigation/scheduler.js", import.meta.url),
    "utf8"
  ),
]);

let now = 0;
let nextHandle = 1;
const timers = new Map();
const idleCallbacks = new Map();
let candidateSends = 0;
let digestReports = 0;
let snapshots = 0;
let processedBatches = 0;

class FakeDate extends Date {
  static now() {
    return now;
  }
}

const window = {
  setTimeout(callback, delayMs = 0) {
    const handle = nextHandle++;
    timers.set(handle, {
      callback,
      dueAt: now + Math.max(0, Number(delayMs) || 0),
    });
    return handle;
  },
  clearTimeout(handle) {
    timers.delete(handle);
  },
  requestIdleCallback(callback) {
    const handle = nextHandle++;
    idleCallbacks.set(handle, callback);
    return handle;
  },
  cancelIdleCallback(handle) {
    idleCallbacks.delete(handle);
  },
};
const sandbox = {
  console,
  Date: FakeDate,
  location: {
    href: "https://source.example/scheduler",
  },
  document: {
    activeElement: null,
  },
  window,
};
sandbox.globalThis = sandbox;

const context = vm.createContext(sandbox);
vm.runInContext(sharedSource, context, { filename: "navigation/shared.js" });
const navigation = context.ZeroLatencyNavigationContent;
navigation.constants.CANDIDATE_SCAN_MAX_WAIT_MS = 250;
Object.assign(navigation, {
  hasActiveEditableFocus() {
    return false;
  },
  sendCandidateLinks() {
    candidateSends += 1;
    return Promise.resolve();
  },
  reportPageDigest() {
    digestReports += 1;
    return Promise.resolve();
  },
  collectPageContentSnapshot() {
    snapshots += 1;
    return {
      pageUrl: context.location.href,
      title: "Scheduler",
      textDigest: "Scheduler",
      contentFingerprint: "fp-scheduler",
    };
  },
  processCandidateMutationWorkBatch() {
    processedBatches += 1;
    return {
      visitedNodes: 0,
      processedAnchors: 0,
      hasPendingWork: false,
    };
  },
});
vm.runInContext(schedulerSource, context, { filename: "navigation/scheduler.js" });

navigation.scheduleCandidateScan({ delayMs: 100, includePageDigest: true });
advanceClock(50);
navigation.scheduleCandidateScan({ delayMs: 100, includePageDigest: true });
advanceClock(100);
navigation.scheduleCandidateScan({ delayMs: 100, includePageDigest: true });
advanceClock(199);
assert.equal(idleCallbacks.size, 0, "trailing debounce must postpone the scan");
advanceClock(200);
assert.equal(idleCallbacks.size, 1, "the trailing deadline should start idle work");
flushIdleCallbacks();
await Promise.resolve();
assert.equal(candidateSends, 1);
assert.equal(digestReports, 1);
assert.equal(snapshots, 1, "one completed scan cycle must create one page snapshot");

advanceClock(300);
navigation.scheduleCandidateScan({ delayMs: 200, includePageDigest: true });
for (const rescheduleAt of [350, 400, 450, 500]) {
  advanceClock(rescheduleAt);
  navigation.scheduleCandidateScan({ delayMs: 200, includePageDigest: true });
}
advanceClock(549);
assert.equal(idleCallbacks.size, 0, "repeated mutations may trail before max wait");
advanceClock(550);
assert.equal(idleCallbacks.size, 1, "max wait must flush continuous mutation traffic");
flushIdleCallbacks();
await Promise.resolve();

assert.equal(candidateSends, 2);
assert.equal(digestReports, 2);
assert.equal(snapshots, 2);
assert.equal(processedBatches, 2);

console.log(
  JSON.stringify(
    {
      ok: true,
      checked: [
        "candidate scans use trailing debounce",
        "continuous changes flush at the maximum wait",
        "each completed scan cycle builds one shared page snapshot",
      ],
    },
    null,
    2
  )
);

function advanceClock(targetTime) {
  while (true) {
    const nextTimer = [...timers.entries()]
      .filter(([, timer]) => timer.dueAt <= targetTime)
      .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];

    if (!nextTimer) {
      break;
    }

    const [handle, timer] = nextTimer;
    timers.delete(handle);
    now = timer.dueAt;
    timer.callback();
  }

  now = targetTime;
}

function flushIdleCallbacks() {
  while (idleCallbacks.size > 0) {
    const [handle, callback] = idleCallbacks.entries().next().value;
    idleCallbacks.delete(handle);
    callback({
      didTimeout: false,
      timeRemaining() {
        return 10;
      },
    });
  }
}
