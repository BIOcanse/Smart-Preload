// 诊断缓冲有积压时不得按固定 10 秒一批地慢慢排。
//
// 缓冲上限 2000、每批 100，此前冲完一批后无条件 scheduleFlush(DEFAULT_FLUSH_DELAY_MS)，
// 完全不看还剩多少：排空要 20 批 × 10 秒 = **200 秒连续存活**。而 MV3 的 service worker
// 约 30 秒空闲就被回收，且 setTimeout 并不延长它的寿命 —— 也就是说满缓冲实际上永远排不完。
//
// pushEvent 里那条 `scheduleFlush(0)`（buffer >= MAX_BATCH_SIZE 时）救不了这个场景：
// scheduleFlush 在 flushTimer 已挂或 flushInProgress 时直接返回。
//
// 失败路径必须仍然退避到 RETRY_FLUSH_DELAY_MS —— 那时立刻重试只会连打后端。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(
  new URL("../../extension/background/diagnostics/logger/flush-buffer.js", import.meta.url),
  "utf8"
);

// 常量从源码解析：顶层 const 不会成为 globalThis 属性，读不到 context 上。
function readConstant(name) {
  const match = source.match(new RegExp(`\\b${name}\\s*=\\s*([0-9_]+)`));
  assert.ok(match, `没能解析常量 ${name}`);
  return Number(match[1].replace(/_/g, ""));
}

const MAX_BUFFERED_EVENTS = readConstant("MAX_BUFFERED_EVENTS");
const MAX_BATCH_SIZE = readConstant("MAX_BATCH_SIZE");
const DEFAULT_FLUSH_DELAY_MS = readConstant("DEFAULT_FLUSH_DELAY_MS");
const RETRY_FLUSH_DELAY_MS = readConstant("RETRY_FLUSH_DELAY_MS");

function createHarness({ failFetch = false } = {}) {
  const scheduledDelays = [];
  const pendingTimers = new Map();
  let nextTimerId = 1;
  let fetchCalls = 0;

  const sandbox = {
    console,
    Object,
    Array,
    String,
    Number,
    Math,
    Error,
    Promise,
    setTimeout: (callback, delayMs) => {
      const timerId = nextTimerId;
      nextTimerId += 1;
      scheduledDelays.push(delayMs);
      pendingTimers.set(timerId, callback);
      return timerId;
    },
    clearTimeout: (timerId) => {
      pendingTimers.delete(timerId);
    },
  };
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: "flush-buffer.js" });

  const buffer = context.ZeroLatencyDiagnosticLoggerFlushBuffer.createDiagnosticLogBuffer({
    sessionId: "test-session",
    isEnabled: () => true,
    fetchNativeApp: async () => {
      fetchCalls += 1;

      if (failFetch) {
        throw new Error("native app unreachable");
      }

      return { written: MAX_BATCH_SIZE, path: "C:/logs/test.log" };
    },
  });

  async function runPendingTimers(maxRounds = 200) {
    for (let round = 0; round < maxRounds; round += 1) {
      const entry = pendingTimers.entries().next();

      if (entry.done) {
        return round;
      }

      const [timerId, callback] = entry.value;
      pendingTimers.delete(timerId);
      callback();
      // flushNow 是 async 的，让它的微任务跑完。
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    return maxRounds;
  }

  return { buffer, scheduledDelays, runPendingTimers, getFetchCalls: () => fetchCalls };
}

// --- 1. 满缓冲必须连续排空，而不是每批等 10 秒 ---
{
  const harness = createHarness();

  for (let index = 0; index < MAX_BUFFERED_EVENTS; index += 1) {
    // schedule: false —— 先把缓冲灌满，不让 pushEvent 的调度掺进来。
    harness.buffer.pushEvent({ sequence: index }, { schedule: false });
  }

  assert.equal(harness.buffer.getStatus({ enabled: true }).bufferedEvents, MAX_BUFFERED_EVENTS);

  harness.scheduledDelays.length = 0;
  await harness.buffer.flushNow();
  await harness.runPendingTimers();

  const remaining = harness.buffer.getStatus({ enabled: true }).bufferedEvents;
  assert.equal(remaining, 0, `排空后还剩 ${remaining} 条`);

  const expectedBatches = MAX_BUFFERED_EVENTS / MAX_BATCH_SIZE;
  assert.equal(
    harness.getFetchCalls(),
    expectedBatches,
    `应当发出 ${expectedBatches} 批`
  );

  const slowReschedules = harness.scheduledDelays.filter(
    (delayMs) => delayMs === DEFAULT_FLUSH_DELAY_MS
  );
  assert.equal(
    slowReschedules.length,
    0,
    `积压期间出现了 ${slowReschedules.length} 次 ${DEFAULT_FLUSH_DELAY_MS}ms 的重排 —— ` +
      `排空 ${MAX_BUFFERED_EVENTS} 条要 ${expectedBatches} 批，每批都等这么久意味着需要 ` +
      `${(expectedBatches * DEFAULT_FLUSH_DELAY_MS) / 1000} 秒连续存活，而 MV3 的 ` +
      "service worker 约 30 秒空闲就被回收"
  );
}

// --- 2. 不足一批时仍然按正常节奏等待（不要空转打后端）---
{
  const harness = createHarness();

  for (let index = 0; index < MAX_BATCH_SIZE + 10; index += 1) {
    harness.buffer.pushEvent({ sequence: index }, { schedule: false });
  }

  harness.scheduledDelays.length = 0;
  await harness.buffer.flushNow();

  assert.equal(
    harness.buffer.getStatus({ enabled: true }).bufferedEvents,
    10,
    "第一批应当只带走 MAX_BATCH_SIZE 条"
  );
  assert.deepEqual(
    Array.from(harness.scheduledDelays, Number),
    [DEFAULT_FLUSH_DELAY_MS],
    "剩余不足一批时应当回到常规节奏，而不是立刻再冲一次"
  );
}

// --- 3. 失败时必须退避，不得因为积压就立刻重试 ---
{
  const harness = createHarness({ failFetch: true });

  for (let index = 0; index < MAX_BUFFERED_EVENTS; index += 1) {
    harness.buffer.pushEvent({ sequence: index }, { schedule: false });
  }

  harness.scheduledDelays.length = 0;
  const result = await harness.buffer.flushNow();

  assert.equal(result.ok, false, "夹具应当让这次 flush 失败");
  assert.equal(
    harness.buffer.getStatus({ enabled: true }).bufferedEvents,
    MAX_BUFFERED_EVENTS,
    "失败的批次必须放回缓冲"
  );
  assert.deepEqual(
    Array.from(harness.scheduledDelays, Number),
    [RETRY_FLUSH_DELAY_MS],
    "失败后即使还有满额积压，也必须退避到重试间隔 —— 否则会连打后端"
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      constants: {
        MAX_BUFFERED_EVENTS,
        MAX_BATCH_SIZE,
        DEFAULT_FLUSH_DELAY_MS,
        RETRY_FLUSH_DELAY_MS,
      },
      checked: [
        "a full buffer drains back-to-back instead of one batch per 10s",
        "a partial remainder returns to the normal cadence",
        "failures still back off to the retry delay even with a full backlog",
      ],
    },
    null,
    2
  )
);
